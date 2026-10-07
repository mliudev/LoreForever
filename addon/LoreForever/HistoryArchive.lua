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
    return string.format(ns.L["History: %d items waiting for companion (~%.1f MB). /reload saves new play."],
      s.pending, s.bytesEstimate / 1048576)
  end
  return ns.L["History archived on this PC. /reload saves new play."]
end
