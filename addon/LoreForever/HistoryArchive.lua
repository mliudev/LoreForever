-- Private, durable-until-receipted history. OFF unless settings.historyArchive == true.
-- The game still writes SavedVariables only on reload/logout; this cannot protect unsaved client memory.
-- Hot journey/chat/text tables keep their existing limits. Never cap this unacknowledged backlog.
local _, ns = ...
local H = {}
ns.HistoryArchive = H

function H.On()
  return type(LoreForeverDB) == "table" and type(LoreForeverDB.settings) == "table"
    and LoreForeverDB.settings.historyArchive == true
end

local function integer(n) return type(n) == "number" and n >= 0 and n < 9007199254740991 and n == math.floor(n) end
local function copy(v, seen)
  if type(v) ~= "table" then
    if type(v) == "string" or type(v) == "boolean" or (type(v) == "number" and v == v and math.abs(v) < math.huge) then return v end
    return nil
  end
  seen = seen or {}
  if seen[v] then error("history payload contains a cycle") end
  seen[v] = true
  local out = {}
  for k, x in pairs(v) do
    if type(k) == "string" or (type(k) == "number" and integer(k)) then out[k] = copy(x, seen) end
  end
  seen[v] = nil
  return out
end

-- Canonical JSON for oversized documents. Table keys are sorted; array keys remain numeric in order.
-- Chunk bodies contain JSON fragments, split only between UTF-8 codepoints. The companion verifies/reassembles
-- these before acknowledging any part. No captured string is truncated to meet a transfer budget.
local function quote(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', c:byte())
  end) .. '"'
end

local function json(v)
  local ty = type(v)
  if ty == "string" then return quote(v) end
  if ty == "number" then return string.format("%.17g", v) end
  if ty == "boolean" then return v and "true" or "false" end
  if ty ~= "table" then return "null" end
  local keys, n, array = {}, 0, true
  for k in pairs(v) do
    n = n + 1
    if type(k) ~= "number" or not integer(k) or k < 1 then array = false end
    keys[#keys + 1] = k
  end
  if array and n > 0 and n == #v then
    local out = {}
    for i = 1, n do out[i] = json(v[i]) end
    return "[" .. table.concat(out, ",") .. "]"
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = quote(tostring(k)) .. ":" .. json(v[k]) end
  return "{" .. table.concat(out, ",") .. "}"
end

local function checksum(s)
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return string.format("%08x", h)
end

local function fragments(s)
  local out, start = {}, 1
  while start <= #s do
    local last = math.min(start + 8191, #s)
    while last < #s and s:byte(last + 1) >= 128 and s:byte(last + 1) < 192 do last = last - 1 end
    out[#out + 1] = s:sub(start, last)
    start = last + 1
  end
  return out
end

local function recordBytes(rec) return #json(rec.payload) + #(rec.streamId or "") * 2 + 192 end

local function token()
  local out = { tostring(time()) }
  -- Persisted random epochs, not second-resolution identities. Reject collisions with known receipts below.
  for i = 1, 8 do out[#out + 1] = string.format("%04x", math.random(0, 65535)) end
  return table.concat(out, "-")
end

function H.ChatId() return token() end

local function data()
  if not H.On() then return nil end
  local a = LoreForeverDB.historyArchive
  if a == nil then
    a = { v = 1, install = token(), streams = {}, active = {} }
    LoreForeverDB.historyArchive = a
  end
  -- Preserve unknown versions intact, with no writes or pruning.
  if type(a) ~= "table" or a.v ~= 1 or type(a.streams) ~= "table" then return nil end
  if type(a.install) ~= "string" then a.install = token() end
  a.active = type(a.active) == "table" and a.active or {}
  return a
end

local function receipts()
  local d = _G.LoreForeverJourneyData
  local a = type(d) == "table" and d.archive
  return type(a) == "table" and a.v == 1 and a.enabled == true and a or nil
end

local function fresh(a, character, previous)
  local r = receipts()
  local id
  repeat id = a.install .. "/" .. character .. "/" .. token()
  until not a.streams[id] and not (r and type(r.receipts) == "table" and r.receipts[id])
  local s = { character = character, seq = 0, ack = 0, records = {}, coverage = "partial", previous = previous,
    migrated = previous and true or nil, bytesEstimate = 0 }
  a.streams[id], a.active[character] = s, id
  return id, s
end

local function stream(character)
  local a = data()
  if not a then return nil end
  character = character or "account"
  local id = a.active[character]
  local s = id and a.streams[id]
  if type(s) ~= "table" then return fresh(a, character) end
  if s.character ~= character or not integer(s.seq) or not integer(s.ack) or s.ack > s.seq
      or type(s.records) ~= "table" then
    return fresh(a, character, id)
  end
  -- A restored game save may be older than the companion's durable receipt. Retain its records, rotate BEFORE append.
  local r = receipts()
  local n = r and type(r.receipts) == "table" and r.receipts[id]
  if integer(n) and n > s.seq then
    s.rollback = true
    return fresh(a, character, id)
  end
  if s.deleted then return fresh(a, character, id) end
  if not s.bytesEstimate then
    s.bytesEstimate = 0
    for _, rec in ipairs(s.records) do s.bytesEstimate = s.bytesEstimate + recordBytes(rec) end
  end
  return id, s
end

function H.Record(character, kind, payload, timestamp)
  if not H.On() then
    local a = type(LoreForeverDB) == "table" and LoreForeverDB.historyArchive
    if type(a) == "table" and a.v == 1 then a.paused = true end
    return nil
  end
  local p = copy(payload) -- copy BEFORE reserving sequence: mutable hot tables cannot change old records
  local id, s = stream(character)
  if not id then return nil end
  local function append(k, content)
    local n = s.seq + 1
    s.records[#s.records + 1] = { v = 1, streamId = id, seq = n, kind = k, time = timestamp or time(),
      characterId = s.character, payload = content }
    s.bytesEstimate = (s.bytesEstimate or 0) + recordBytes(s.records[#s.records])
    s.seq = n
  end
  local encoded = json(p)
  if #encoded > 16384 then
    local parts = fragments(encoded)
    local documentId = id .. ":" .. (s.seq + #parts + 1)
    local sum = checksum(encoded)
    for i, part in ipairs(parts) do
      append("text", { archiveChunk = { id = documentId, part = i, parts = #parts, hash = sum, bytes = #encoded,
        algorithm = "djb2", encoding = "json-v1", text = part } })
    end
    p = { archiveDocument = { id = documentId, parts = #parts, hash = sum, bytes = #encoded,
      algorithm = "djb2", encoding = "json-v1" } }
  end
  append(kind, p)
  s.migrated = true
  return id .. ":" .. s.seq
end

function H.ApplyReceipts()
  local a, r = data(), receipts()
  if not (a and r and type(r.receipts) == "table") then return end
  for _, id in ipairs(type(r.deleted) == "table" and r.deleted or {}) do
    local s = type(id) == "string" and a.streams[id]
    if type(s) == "table" and not s.deleted then
      s.deleted = true
      if a.active[s.character] == id then fresh(a, s.character, id) end
    end
  end
  for id, s in pairs(a.streams) do
    local n = r.receipts[id]
    if type(s) == "table" and not s.deleted and integer(n) and integer(s.seq) and integer(s.ack)
        and s.ack <= s.seq and type(s.records) == "table" then
      if n > s.seq then
        s.rollback = true
        if a.active[s.character] == id then fresh(a, s.character, id) end
      elseif n > s.ack then
        -- Validate the exact pending contiguous prefix, including envelope identity. A gap/conflict never prunes.
        local nextSeq, valid, document, pieces = s.ack + 1, true, nil, nil
        for _, rec in ipairs(s.records) do
          if type(rec) ~= "table" or rec.v ~= 1 or rec.streamId ~= id or rec.characterId ~= s.character
              or rec.seq ~= nextSeq then valid = false break end
          nextSeq = nextSeq + 1
          local chunk = type(rec.payload) == "table" and rec.payload.archiveChunk
          local manifest = type(rec.payload) == "table" and rec.payload.archiveDocument
          if chunk then
            if type(chunk) ~= "table" or type(chunk.text) ~= "string" or chunk.algorithm ~= "djb2"
                or chunk.encoding ~= "json-v1" or not integer(chunk.parts) or chunk.parts < 1 then valid = false break end
            if not document then document, pieces = chunk, {} end
            if chunk.id ~= document.id or chunk.part ~= #pieces + 1 or chunk.parts ~= document.parts
                or chunk.hash ~= document.hash or chunk.bytes ~= document.bytes then valid = false break end
            pieces[#pieces + 1] = chunk.text
          elseif manifest then
            if type(manifest) ~= "table" or not document or manifest.id ~= id .. ":" .. rec.seq
                or manifest.id ~= document.id or manifest.parts ~= #pieces or manifest.parts ~= document.parts
                or manifest.algorithm ~= document.algorithm or manifest.encoding ~= document.encoding
                or manifest.hash ~= document.hash or manifest.bytes ~= document.bytes then valid = false break end
            local encoded = table.concat(pieces)
            if #encoded ~= manifest.bytes or checksum(encoded) ~= manifest.hash then valid = false break end
            document, pieces = nil, nil
          elseif document then valid = false break end
          -- The companion never acknowledges half a document; reject such a boundary if its file is malformed.
          if rec.seq == n and document then valid = false break end
        end
        if valid and not document and nextSeq == s.seq + 1 then
          local keep = {}
          local bytes = 0
          for _, rec in ipairs(s.records) do
            if rec.seq > n then keep[#keep + 1] = rec; bytes = bytes + recordBytes(rec) end
          end
          s.records, s.ack = keep, n
          s.bytesEstimate = bytes
        end
      end
    end
  end
end

function H.Snapshot(character, c, provenance)
  if not H.On() or type(c) ~= "table" then return end
  local out = {}
  for k, v in pairs(c) do if k ~= "events" and k ~= "trail" then out[k] = v end end
  H.Record(character, "snapshot", { journey = out, provenance = provenance or "save", coverage = "partial" })
end

function H.Question(entry, revision)
  if not H.On() then return end
  if not entry.archiveId then
    entry.archiveId = H.Record("account", "question", { entry = entry, revision = revision or "created" }, entry.t)
  else
    H.Record("account", "question", { id = entry.archiveId, entry = entry, revision = revision or "updated" }, entry.t)
  end
end

function H.Text(kind, ref, part, content)
  if H.On() then H.Record("account", "text", { kind = kind, ref = tostring(ref), part = tostring(part or ""), content = content }) end
end

function H.Init()
  if not H.On() then
    local a = type(LoreForeverDB) == "table" and LoreForeverDB.historyArchive
    if type(a) == "table" and a.v == 1 then a.paused = true end
    return
  end
  local a = data()
  if not a then return end
  if a.paused then
    for _, s in pairs(a.streams) do if type(s) == "table" then s.migrated = nil end end
    a.paused = nil
  end
  H.ApplyReceipts()
  -- Capture every survivor before Journey's v1 migration, open() trim or Capture's shipped/sent pruning.
  local chars = LoreForeverDB.journey and LoreForeverDB.journey.chars or {}
  for key, c in pairs(chars) do
    local _, s = stream(key)
    if s and not s.migrated and type(c) == "table" then
      for i, e in ipairs(c.events or {}) do
        if not e.archiveId then e.archiveId = H.Record(key, "event", e, e.t) end
      end
      for period, pts in pairs(c.trail or {}) do
        for i, p in ipairs(pts) do H.Record(key, "trail", { period = period, point = p, legacyIndex = i }, p.t) end
      end
      H.Snapshot(key, c, "legacy_survivors")
      s.migrated = true
    end
  end
  local _, s = stream("account")
  if s and not s.migrated then
    for _, q in ipairs(LoreForeverDB.questions or {}) do H.Question(q, "legacy_survivor") end
    for i, c in ipairs(LoreForeverDB.history or {}) do H.Record("account", "chat", { chat = c, legacyIndex = i, coverage = "partial" }, c.t) end
    for id, q in pairs(LoreForeverDB.quests or {}) do H.Text("quest", id, nil, q) end
    for kind, contents in pairs(LoreForeverDB.texts or {}) do
      for ref, texts in pairs(contents) do H.Text(kind, ref, nil, texts) end
    end
    H.Record("account", "snapshot", { provenance = "legacy_survivors", coverage = "partial",
      maps = LoreForeverDB.maps, visits = LoreForeverDB.visits, capture = LoreForeverDB.capture })
    s.migrated = true
  end
end

function H.Save()
  if not H.On() then return end
  for key, c in pairs(LoreForeverDB.journey and LoreForeverDB.journey.chars or {}) do H.Snapshot(key, c) end
  H.Record("account", "snapshot", { maps = LoreForeverDB.maps, visits = LoreForeverDB.visits,
    capture = LoreForeverDB.capture, provenance = "save", coverage = "partial" })
end

-- Forget (LOR-1496, PR 4d; docs/qa/chats.md F22-F31). A player who forgets an exchange in Willo's talk shouldn't get it
-- back from the add-on's own saved history (Willo imports it again after a reinstall). Willo lists what was forgotten
-- in its add-on's Data.lua: LoreForeverJourneyData.forgetHistory = { key, ... } (newest last, at most 500). A key is
--   "<stream>:<seq>"  an archive record's id (a chat_message record, the turn's message_id in Willo), or
--   "<t>:<crc32>"     a question by its time (the message's own t, else its chat's: chat.t, or the record's time for a
--                     chat_message record, as Willo's import reads it) and the CRC-32 (Strip.CRC32, zlib's) of its text
--                     after Willo's clean-up (lore_companion/chat.py plain: links to their words, colour codes and |r
--                     out, || as |, trimmed).
-- At login, LoreForeverDB.history loses that question and the answers after it up to the next question (a saved chat
-- with no question left goes); in historyArchive the same messages are blanked in place (text "", forgotten = true,
-- nothing else kept but role and t), so every record keeps its place and seq and the receipts still match; a chunked
-- document is written back in the same number of parts with its size and hash redone. Nothing else in a chat changes.
-- A question found by one key is also dropped from the other copies of its chat (the saved chat, its snapshots and its
-- chat_message records share the chat id), since each copy has its own fallback time. Only the chunked documents that
-- could hold a listed question (a listed time or record id, or the chat id of a question found) are decoded. Runs once
-- per list: the list's signature is kept in LoreForeverDB.forgetDone, set only when every blanked document was written
-- back. An older Willo writes no list: nothing happens.

local CHUNK_LIMIT = 16384   -- the companion's limit on a chunk's text (lore_companion/archive.py _documents)

local function cleaned(s)
  if type(s) ~= "string" then return "" end
  s = s:gsub("|H[^|]*|h([^\n]-)|h", "%1")
  -- Colour codes and |r in one left-to-right pass, as Python's re.sub(r"\|c[0-9a-fA-F]{8}|\|r", "", s) does: what's left
  -- after a cut isn't looked at again ("||cffffffffr" keeps "|r", which a second pass would take out).
  if s:find("|", 1, true) then
    local out, i = {}, 1
    while true do
      local j = s:find("|", i, true)
      if not j then out[#out + 1] = s:sub(i) break end
      local c = s:sub(j + 1, j + 1)
      if c == "r" then
        out[#out + 1], i = s:sub(i, j - 1), j + 2
      elseif c == "c" and s:find("^%x%x%x%x%x%x%x%x", j + 2) then
        out[#out + 1], i = s:sub(i, j - 1), j + 10
      else
        out[#out + 1], i = s:sub(i, j), j + 1
      end
    end
    s = table.concat(out):gsub("||", "|")
  end
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end
H.ForgetText = cleaned

-- A time as Willo's import reads it: Python's `msg.get("t") or fallback`, then a whole number of seconds or no match.
local function when(own, fallback)
  local t = own
  if t == nil or t == false or t == 0 or t == "" then t = fallback end
  if type(t) == "number" and t > 0 and t < 1e11 and t == math.floor(t) then return t end
  return nil
end

local function decode(s)
  local pos = 1
  local function ws() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
  local ESC = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
  local function str()
    local out, i = {}, pos + 1
    while true do
      local j = s:find('["\\]', i)
      if not j then error("json") end
      out[#out + 1] = s:sub(i, j - 1)
      if s:sub(j, j) == '"' then pos = j + 1 return table.concat(out) end
      local e = s:sub(j + 1, j + 1)
      if e == "u" then
        local h = tonumber(s:sub(j + 2, j + 5), 16)
        if not h or h > 127 then error("json") end
        out[#out + 1], i = string.char(h), j + 6
      elseif ESC[e] then
        out[#out + 1], i = ESC[e], j + 2
      else error("json") end
    end
  end
  local value
  value = function()
    ws()
    local c = s:sub(pos, pos)
    if c == "{" or c == "[" then
      local o, close = {}, c == "{" and "}" or "]"
      pos = pos + 1
      ws()
      if s:sub(pos, pos) == close then pos = pos + 1 return o end
      while true do
        if c == "{" then
          ws()
          if s:sub(pos, pos) ~= '"' then error("json") end
          local k = str()
          ws()
          if s:sub(pos, pos) ~= ":" then error("json") end
          pos = pos + 1
          o[k] = value()
        else
          o[#o + 1] = value()
        end
        ws()
        local d = s:sub(pos, pos)
        pos = pos + 1
        if d == close then return o elseif d ~= "," then error("json") end
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4 return true
    elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5 return false
    end
    local num = s:match("^-?[%d%.eE+%-]+", pos)
    if not num or not tonumber(num) then error("json") end
    pos = pos + #num
    return tonumber(num)
  end
  local v = value()
  ws()
  if pos <= #s then error("json") end
  return v
end

-- Split a document into exactly n parts, each within the companion's limit and cut between UTF-8 characters. Parts
-- may be empty (the companion and ApplyReceipts take "" as a part): a 1 MB answer forgotten shrinks to a few hundred
-- bytes but keeps its ~150 parts, since its records can't move or go.
local function split(s, n)
  local out, start = {}, 1
  for i = 1, n do
    local last = #s
    if i < n then
      last = start + math.ceil((#s - start + 1) / (n - i + 1)) - 1
      while last >= start and last < #s and s:byte(last + 1) >= 128 and s:byte(last + 1) < 192 do last = last + 1 end
    end
    out[i] = s:sub(start, last)
    if #out[i] > CHUNK_LIMIT then return nil end
    start = last + 1
  end
  return out
end

-- The archive's records as logical records. A chunked document comes with its chunk records and isn't decoded here:
-- decoding is the slow part of Forget (Lua, every byte), so only a document that could hold a listed question is
-- (open, in H.Forget).
local function logical(s)
  local out, pending = {}, {}
  for _, rec in ipairs(type(s.records) == "table" and s.records or {}) do
    local p = type(rec) == "table" and rec.payload
    if type(p) == "table" and type(p.archiveChunk) == "table" then
      pending[#pending + 1] = rec
    elseif type(p) == "table" and type(p.archiveDocument) == "table" then
      out[#out + 1] = { rec = rec, kind = rec.kind, chunks = pending }
      pending = {}
    elseif type(p) == "table" then
      pending = {}
      out[#out + 1] = { rec = rec, kind = rec.kind, payload = p }
    end
  end
  return out
end

-- A chunked document's JSON when its parts and size check out, else false (cheap: no Lua loop over its bytes).
local function joined(doc)
  if doc.text == nil then
    local m, parts = doc.rec.payload.archiveDocument, {}
    for i, c in ipairs(doc.chunks) do
      local ch = c.payload.archiveChunk
      if ch.id ~= m.id or ch.part ~= i or type(ch.text) ~= "string" then parts = nil break end
      parts[i] = ch.text
    end
    doc.text = false
    if parts and #parts == m.parts and #parts > 0 then
      local encoded = table.concat(parts)
      if #encoded == m.bytes then doc.text = encoded end
    end
  end
  return doc.text
end

-- A chunked document decoded, when its hash and a round trip back to the same bytes check out; else false.
local function open(doc)
  if doc.payload == nil then
    doc.payload = false
    local encoded = joined(doc)
    if encoded and checksum(encoded) == doc.rec.payload.archiveDocument.hash then
      local ok, payload = pcall(decode, encoded)
      if ok and type(payload) == "table" and json(payload) == encoded then doc.payload = payload end
    end
  end
  return doc.payload
end

local function rewrite(doc)
  local encoded = json(doc.payload)
  local parts = split(encoded, #doc.chunks)
  if not parts then return false end
  local sum = checksum(encoded)
  for i, c in ipairs(doc.chunks) do
    local ch = c.payload.archiveChunk
    ch.text, ch.hash, ch.bytes = parts[i], sum, #encoded
  end
  doc.rec.payload.archiveDocument.hash, doc.rec.payload.archiveDocument.bytes = sum, #encoded
  return true
end

-- Blank one archived message in place; false when it already was.
local function blank(m)
  local done = m.text == "" and m.forgotten == true
  for k in pairs(m) do
    if k ~= "role" and k ~= "t" and k ~= "text" and k ~= "forgotten" then done = false end
  end
  if done then return false end
  for k in pairs(m) do if k ~= "role" and k ~= "t" then m[k] = nil end end
  m.text, m.forgotten = "", true
  return true
end

local function title(msgs)
  for _, m in ipairs(msgs) do
    if type(m) == "table" and m.role == "user" and cleaned(m.text) ~= "" then return cleaned(m.text):sub(1, 60) end
  end
end

function H.Forget()
  local d = _G.LoreForeverJourneyData
  local list = type(d) == "table" and d.forgetHistory
  if type(list) ~= "table" or type(LoreForeverDB) ~= "table" then return end
  local keys = {}
  for i = math.max(1, #list - 499), #list do
    local k = list[i]
    if type(k) == "string" and #k <= 512 then keys[#keys + 1] = k end
  end
  if #keys == 0 then return end
  local sig = #keys .. ":" .. checksum(table.concat(keys, "\n"))
  if LoreForeverDB.forgetDone == sig then return end
  local byTime, byRecord = {}, {}
  for _, k in ipairs(keys) do
    local t, c = k:match("^(%d+):(%d+)$")
    if t then
      t, c = tonumber(t), tonumber(c)
      byTime[t] = byTime[t] or {}
      byTime[t][c] = true
    elseif k:match("^.+:%d+$") then
      byRecord[k] = true
    end
  end

  local CRC = ns.Strip and ns.Strip.CRC32
  if not CRC then return end

  -- Every copy of a saved chat as a thread of items: { m = message, fb = its fallback time, id = record id, doc }.
  local threads = {}
  for _, c in ipairs(type(LoreForeverDB.history) == "table" and LoreForeverDB.history or {}) do
    if type(c) == "table" and type(c.msgs) == "table" then
      local items = {}
      for _, m in ipairs(c.msgs) do if type(m) == "table" then items[#items + 1] = { m = m, fb = c.t } end end
      threads[#threads + 1] = { chatId = c.id, items = items, saved = c }
    end
  end
  local function add(doc)
    local p = doc.payload
    if doc.kind == "chat" and type(p.chat) == "table" and type(p.chat.msgs) == "table" then
      local items = {}
      for _, m in ipairs(p.chat.msgs) do
        if type(m) == "table" then items[#items + 1] = { m = m, fb = p.chat.t, doc = doc } end
      end
      threads[#threads + 1] = { chatId = p.chat.id, items = items, snapshot = p.chat }
    elseif doc.kind == "chat_message" and type(p.message) == "table" and p.chatId ~= nil then
      local th = doc.byChat[p.chatId]
      if not th then
        th = { chatId = p.chatId, items = {}, records = true }
        doc.byChat[p.chatId] = th
        threads[#threads + 1] = th
      end
      th.items[#th.items + 1] = { m = p.message, fb = doc.rec.time or doc.rec.t, doc = doc, id = doc.id, pos = doc.pos }
    end
  end
  -- Could this chunked document hold a question a key names by time? Its own time (a chat_message's fallback) or a
  -- "t" in its JSON (a message's own, or a snapshot chat's) is listed. Plain finds, so a big archive stays cheap.
  local function timed(doc)
    if doc.kind == "chat_message" and byTime[when(nil, doc.rec.time or doc.rec.t) or false] then return true end
    local text, i = joined(doc), 1
    if not text then return false end
    while true do
      local j = text:find('"t":', i, true)
      if not j then return false end
      local n = text:match("^%d+", j + 4)
      if n and byTime[tonumber(n)] then return true end
      i = j + 4
    end
  end
  local a = LoreForeverDB.historyArchive
  local closed = {}   -- chunked chat documents not decoded (yet)
  if type(a) == "table" and a.v == 1 and type(a.streams) == "table" then
    for sid, s in pairs(a.streams) do
      if type(s) == "table" then
        local byChat = {}
        for pos, doc in ipairs(logical(s)) do
          doc.stream, doc.byChat, doc.pos, doc.id = s, byChat, pos, sid .. ":" .. tostring(doc.rec.seq)
          if not doc.chunks then
            add(doc)
          elseif doc.kind == "chat" or doc.kind == "chat_message" then
            if byRecord[doc.id] or timed(doc) then
              if open(doc) then add(doc) end
            elseif joined(doc) then
              closed[#closed + 1] = doc
            end
          end
        end
      end
    end
  end

  local function crc(it)
    if it.crc == nil then
      local text = cleaned(it.m.text)
      it.crc = text ~= "" and CRC(text) or false
    end
    return it.crc
  end
  -- The questions the keys name, then the same question in the other copies of its chat.
  local derived, chatsHit = {}, {}
  local function direct(from)
    for n = from, #threads do
      local th = threads[n]
      for _, it in ipairs(th.items) do
        -- A record named by its id counts even when it's already blank: a run that stopped on an error after blanking
        -- it must still reach its chunked answer and the chat's snapshots on the next login.
        if not it.hit and it.m.role == "user" and type(it.m.text) == "string"
            and ((it.id and byRecord[it.id]) or it.m.text ~= "") then
          local t = when(it.m.t, it.fb)
          if (it.id and byRecord[it.id]) or (t and byTime[t] and crc(it) and byTime[t][crc(it)]) then
            it.hit = true
            if th.chatId ~= nil then
              chatsHit[th.chatId] = true
              derived[th.chatId] = derived[th.chatId] or {}
              table.insert(derived[th.chatId], { crc = crc(it), t = when(it.m.t) })
            end
          end
        end
      end
    end
  end
  direct(1)
  -- The other copies of a chat a question was found in (its snapshots, its answers' records), when they're chunked.
  if next(chatsHit) then
    local ids = {}
    for id in pairs(chatsHit) do ids[#ids + 1] = json(id) end
    for _, doc in ipairs(closed) do
      for _, id in ipairs(ids) do
        if doc.text:find(id, 1, true) then
          if open(doc) then add(doc) end
          break
        end
      end
    end
    for _, th in ipairs(threads) do
      if th.records then table.sort(th.items, function(x, y) return x.pos < y.pos end) end
    end
    direct(1)
  end
  -- For each chat and words, the newest save time (fallback: the chat's or the record's time) of a copy without its own
  -- time. An ask with those words was said before the update only if its own time is no later than that: a reopened old
  -- ask takes its chat's time then, and a newer ask with the same words is later.
  local oldUpto = {}
  for _, th in ipairs(threads) do
    if th.chatId ~= nil and derived[th.chatId] then
      for _, it in ipairs(th.items) do
        local f = it.m.role == "user" and not when(it.m.t) and crc(it) and when(nil, it.fb)
        if f then
          local byCrc = oldUpto[th.chatId] or {}
          oldUpto[th.chatId] = byCrc
          if not byCrc[it.crc] or f > byCrc[it.crc] then byCrc[it.crc] = f end
        end
      end
    end
  end
  -- Is this copy of a question the same ask as a found one? Same words, and times that fit: two own times are equal; an
  -- own time and none match when the own time is no later than that chat's newest no-time save of those words; two
  -- without, both go (admitted). A found copy that's already blank (no words left) matches by its own time alone.
  local function sameAsk(it, x, chatId)
    local own = when(it.m.t)
    if not x.crc then return x.t ~= nil and own == x.t end
    if x.crc ~= crc(it) then return false end
    if own and x.t then return own == x.t end
    if not own and not x.t then return true end
    local upto = oldUpto[chatId] and oldUpto[chatId][x.crc]
    return upto ~= nil and (own or x.t) <= upto
  end
  for _, th in ipairs(threads) do
    local same = th.chatId ~= nil and derived[th.chatId]
    if same then
      for _, it in ipairs(th.items) do
        if not it.hit and it.m.role == "user" and (crc(it) or it.m.text == "") then
          for _, x in ipairs(same) do
            if sameAsk(it, x, th.chatId) then it.hit = true break end
          end
        end
      end
    end
  end

  -- Drop (the saved chats) or blank (the archive) each question found and the answers after it.
  local dirty, store = {}, LoreForeverDB.history
  for _, th in ipairs(threads) do
    local dropping, changed = false, false
    for _, it in ipairs(th.items) do
      if it.m.role == "user" then dropping = it.hit or false end
      if dropping and (it.m.role == "user" or it.m.role == "lore") then
        it.drop = true
        if not th.saved and blank(it.m) then
          changed = true
          dirty[it.doc] = true
        end
      end
    end
    if th.saved then
      local keep = {}
      for _, it in ipairs(th.items) do if not it.drop then keep[#keep + 1] = it.m end end
      local changedSaved = #keep ~= #th.saved.msgs
      -- A chat with no question left goes, and so does one with no messages at all (left by a run an error stopped).
      if #keep == 0 or (changedSaved and not title(keep)) then
        for i = #store, 1, -1 do if store[i] == th.saved then table.remove(store, i) end end
      elseif changedSaved then
        th.saved.msgs = keep
        th.saved.title = title(keep)
      end
    elseif th.snapshot and changed then
      th.snapshot.title = title(th.snapshot.msgs) or ""
    end
  end
  -- A document that can't be written back keeps its words: the list isn't marked done, so the next login tries again.
  local whole = true
  for doc in pairs(dirty) do
    if doc.chunks and not rewrite(doc) then whole = false end
    doc.stream.bytesEstimate = nil   -- redone on next use (stream, H.Status)
  end
  if whole then LoreForeverDB.forgetDone = sig end
end

function H.Status()
  local a = data()
  if not a then return nil end
  local pending, archived, bytes = 0, 0, 0
  for _, s in pairs(a.streams) do
    if type(s) == "table" and not s.deleted and integer(s.seq) and integer(s.ack) and s.ack <= s.seq then
      pending, archived = pending + s.seq - s.ack, archived + s.ack
      if not s.bytesEstimate then
        s.bytesEstimate = 0
        for _, rec in ipairs(s.records or {}) do s.bytesEstimate = s.bytesEstimate + recordBytes(rec) end
      end
      bytes = bytes + s.bytesEstimate
    end
  end
  return { pending = pending, archived = archived, bytesEstimate = bytes, coverage = "partial" }
end

function H.StatusText()
  local s = H.Status()
  if not s then return nil end
  if s.pending > 0 then
    return string.format(ns.L["History: %d items waiting for %s (~%.1f MB). /reload saves new play."],
      s.pending, ns.COMPANION_NAME, s.bytesEstimate / 1048576)
  end
  return ns.L["History archived on this PC. /reload saves new play."]
end
