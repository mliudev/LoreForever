-- Questions in a page's margin (v2 "Your Chronicle", slice 5): what you asked about a place, person, item or quest is
-- written on its page, under "Questions", with its answer, whether you asked on the page or in the conversation. The
-- answers in your saved conversations (History) are moved onto their pages once, the first time a page opens with
-- this version; nothing leaves History.
--
-- LoreForeverDB.collection.chars[char].asked = { [key] = { { q = question, a = answer, t = time }, ... } }   oldest
--   first, at most KEEP a page; askedFilled = FILL once History's answers are on their pages.

local _, ns = ...
local Margin = {}
ns.Margin = Margin

local KEEP = 5        -- questions a page keeps (the oldest goes)
local MAX_A = 600     -- an answer's characters kept (a story asked for is on the page already)
local FILL = 1

local function now() return (type(time) == "function" and time()) or 0 end

-- Text as read, without colours, links or icons.
function Margin.Plain(s)
  s = tostring(s or "")
  s = s:gsub("|H.-|h(.-)|h", "%1"):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("||", "|")
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function short(a)
  a = Margin.Plain(a)
  if #a <= MAX_A then return a end
  local cut = a:sub(1, MAX_A)
  local stop = cut:match("^(.*[%.!?])%s")
  return (stop and #stop > MAX_A / 2 and stop or cut) .. " …"
end

local function store()
  local r = ns.Collection.Store()
  if not r then return nil end
  if type(r.asked) ~= "table" then r.asked = {} end
  return r
end

local function add(r, key, q, a, t)
  if not (key and ns.DB.entries[key]) or type(q) ~= "string" or q == "" then return end
  local list = r.asked[key]
  if type(list) ~= "table" then list = {}; r.asked[key] = list end
  local lq = q:lower()
  for i = #list, 1, -1 do
    if type(list[i]) == "table" and tostring(list[i].q or ""):lower() == lq then table.remove(list, i) end
  end
  list[#list + 1] = { q = q, a = short(a), t = t or now() }
  while #list > KEEP do table.remove(list, 1) end
end

-- A question answered with `key`'s lore (UI.Ask): written on its page. Margin.last is the newest, for the page's
-- own ask line.
function Margin.Note(key, question, answer)
  local r = store()
  if not r then return end
  local q = Margin.Plain(question)
  add(r, key, q, answer)
  Margin.last = { key = key, q = q }
end

-- History's answers onto their pages: each answer (a "lore" message about a page) with the question before it.
function Margin.Fill()
  local r = store()
  if not r or r.askedFilled == FILL then return end
  r.askedFilled = FILL
  local chats = LoreForeverDB and LoreForeverDB.history
  local list = {}
  for _, c in ipairs(type(chats) == "table" and chats or {}) do
    if type(c) == "table" and type(c.msgs) == "table" then list[#list + 1] = c end
  end
  table.sort(list, function(a, b) return (tonumber(a.t) or 0) < (tonumber(b.t) or 0) end)
  for _, c in ipairs(list) do
    for i = 2, #c.msgs do
      local m, prev = c.msgs[i], c.msgs[i - 1]
      if type(m) == "table" and type(prev) == "table" and m.role == "lore" and prev.role == "user"
          and type(m.subject) == "string" then
        local a = Margin.Plain(m.text):gsub("^[^\n]*\n", "", 1)   -- the answer under its heading
        add(r, m.subject, Margin.Plain(prev.text), a, tonumber(c.t))
      end
    end
  end
end

-- `key`'s questions, the newest first.
function Margin.List(key)
  local r = store()
  if not r then return {} end
  Margin.Fill()
  local out, list = {}, r.asked[key]
  for i = #(type(list) == "table" and list or {}), 1, -1 do
    if type(list[i]) == "table" then out[#out + 1] = list[i] end
  end
  return out
end
