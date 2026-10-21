-- Lore Forever's own Lua errors, kept so that "I got a Lua error" comes with the error itself (LOR-52). It loads first
-- of the code (right after the generated data, which must come first), so an error while the rest loads is kept too.
--
-- The game hands every Lua error to its error handler. Lore Forever puts a handler in front of the one that's there:
-- it keeps the errors that come from Lore Forever (one of its files in the message or at the top of the stack) and
-- always passes every error on, unchanged, to the handler it found, so the game's error popup, BugSack and other
-- add-ons see exactly what they saw before. Nothing is swallowed and no Blizzard function is replaced: it only calls
-- seterrorhandler. BugGrabber keeps the handler to itself; then the errors come from its callback instead. "Lore
-- Forever has been blocked from an action" (ADDON_ACTION_FORBIDDEN, and the quieter ADDON_ACTION_BLOCKED, through
-- Core.lua's events) is kept too: players call that popup a Lua error as well.
--
-- LoreForeverDB.errors = { { msg, stack, n, first, last, v }, ... }, least recently seen first: the message (cut to
-- MSG letters), the top of the stack (STACK lines, at most STACK_LETTERS), how many times it happened, when first and
-- last (time()), and the add-on version it last happened in. The same message counts up instead of adding a row, and
-- only the MAX most recently seen stay. The game writes it on /reload or logout, like the rest of LoreForeverDB.
-- /lore errors (Core.lua) shows them in a box to copy into loreforeverwow.com/feedback or Discord; the first new one
-- in a session says so in chat, once. Nothing leaves the PC by itself. tests/errors_sim.py checks all of this.

local addonName, ns = ...
local Errors = {}
ns.Errors = Errors

local MAX, MSG, STACK, STACK_LETTERS = 20, 400, 10, 1200
local REPORT_LETTERS = 3800        -- under the 4,000 letters loreforeverwow.com/feedback takes
local pending = {}                 -- kept before SavedVariables load (ADDON_LOADED); moved into them then
local ready = false                -- LoreForeverDB has loaded (Errors.Init)
local loggedIn, hint = false, nil  -- hint: "once" when the chat line waits for login, "said" once it's said

local function cut(s, n)
  s = tostring(s or "")
  return #s > n and (s:sub(1, n - 3) .. "...") or s
end

local version
local function addonVersion()
  if version then return version end
  local get = (_G.C_AddOns and C_AddOns.GetAddOnMetadata) or _G.GetAddOnMetadata
  local ok, v = pcall(get, addonName, "Version")
  version = (ok and type(v) == "string" and v ~= "") and v or nil
  return version or "?"
end

local function rows()
  if not ready then return pending end
  if type(LoreForeverDB.errors) ~= "table" then LoreForeverDB.errors = {} end
  return LoreForeverDB.errors
end

-- The top of a stack, as lines: at most STACK of them, and of STACK_LETTERS in all.
local function topOf(stack)
  if type(stack) ~= "string" or stack == "" then return nil end
  local lines = {}
  for line in stack:gmatch("[^\n]+") do
    if #lines >= STACK then break end
    lines[#lines + 1] = line
  end
  return cut(table.concat(lines, "\n"), STACK_LETTERS)
end

-- Lore Forever's own: one of its folders in the message, or in the two innermost lines of the stack (an error raised
-- inside a game function it called; the message of one like that doesn't always name the file).
local function ours(msg, stack)
  if msg:find("LoreForever", 1, true) then return true end
  local n = 0
  for line in (stack or ""):gmatch("[^\n]+") do
    if line:find("AddOns[/\\]LoreForever") then return true end
    n = n + 1
    if n >= 2 then break end
  end
  return false
end

local function say(msg)
  if _G.DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end
end

local function sayHint()
  hint = "said"
  say(ns.L["something went wrong (a Lua error). Type /lore errors to copy what happened for a bug report."])
end

-- Keep one error (or count it again). Returns true for one not kept before.
local function keep(msg, stack, tell)
  -- The usage counts (Log.lua, LOR-435) note how many, never the message; only once LoreForeverDB has loaded.
  if ready and ns.Log and ns.Log.Use then ns.Log.Use("err") end
  msg = cut(msg, MSG)
  local list, now = rows(), (_G.time and time()) or 0
  for i, e in ipairs(list) do
    if e.msg == msg then
      table.remove(list, i)
      list[#list + 1] = e
      e.n, e.last, e.v = (tonumber(e.n) or 1) + 1, now, addonVersion()
      e.stack = topOf(stack) or e.stack
      return false
    end
  end
  list[#list + 1] = { msg = msg, stack = topOf(stack), n = 1, first = now, last = now, v = addonVersion() }
  while #list > MAX do table.remove(list, 1) end
  if tell and not hint then
    hint = "once"
    -- Not from inside the error handler: the chat line goes out on the next frame (or at login, for a load error).
    if loggedIn and _G.C_Timer then C_Timer.After(0, sayHint) end
  end
  return true
end

-- An error from the handler or BugGrabber. Never raises: an error in here would reach the handler again.
local function capture(msg, stack)
  pcall(function()
    msg = tostring(msg)
    if ours(msg, stack) then keep(msg, stack, true) end
  end)
end
Errors.Capture = capture

local handler
local function install()
  if not (_G.geterrorhandler and _G.seterrorhandler) then return false end
  local prev = geterrorhandler()
  local function mine(msg, ...)
    -- The stack where the error happened: this handler runs on top of it (level 1 is this function).
    capture(msg, _G.debugstack and debugstack(2, STACK, 0) or nil)
    if prev then return prev(msg, ...) end
  end
  pcall(seterrorhandler, mine)
  if geterrorhandler() ~= mine then return false end
  handler = mine
  return true
end

-- BugGrabber (with BugSack) replaces seterrorhandler, so nobody else's handler goes in; it tells its listeners instead.
local function listenToBugGrabber()
  local BG = _G.BugGrabber
  if type(BG) ~= "table" or type(BG.RegisterCallback) ~= "function" then return false end
  return (pcall(BG.RegisterCallback, Errors, "BugGrabber_BugGrabbed", function(_, e)
    if type(e) == "table" then capture(e.message, e.stack) end
  end))
end

Errors.source = (install() and "handler") or (listenToBugGrabber() and "BugGrabber") or nil

-- Core.lua's events (Errors.lua has no frame of its own): ADDON_LOADED, once LoreForeverDB has loaded (Log.Init), moves
-- what was kept while the add-on loaded into it.
function Errors.Init()
  if ready or type(LoreForeverDB) ~= "table" then return end
  ready = true
  local early = pending
  pending = {}
  for _, e in ipairs(early) do
    if keep(e.msg, e.stack, false) then
      local list = rows()
      list[#list].n, list[#list].first = e.n, e.first
    end
  end
end

-- PLAYER_LOGIN, first thing (an error later in login still gets its chat line): the chat line for an error from
-- while the add-on loaded, after the login lines.
function Errors.OnLogin()
  loggedIn = true
  if hint == "once" and _G.C_Timer then C_Timer.After(3, sayHint) end
end

-- ADDON_ACTION_FORBIDDEN and ADDON_ACTION_BLOCKED (who, the protected function). FORBIDDEN is the popup players
-- see; BLOCKED happens quietly (often in combat), so it's kept without a chat line.
function Errors.OnBlocked(event, who, fn)
  if who ~= addonName then return end
  pcall(keep, string.format("%s: %s tried to call %s()", tostring(event), addonName, tostring(fn or "?")), nil,
    event == "ADDON_ACTION_FORBIDDEN")
end

-- What's kept, least recently seen first (the rows themselves: read only).
function Errors.List()
  return rows()
end

function Errors.Clear()
  pending = {}
  if ready then LoreForeverDB.errors = {} end
end

local function when(t)
  t = tonumber(t)
  if not (t and t > 0) then return "?" end
  return (_G.date and date("%Y-%m-%d %H:%M", t)) or tostring(t)
end

-- The text /lore errors shows to copy: the versions, then each error, most recently seen first, as long as it fits in
-- what the feedback page takes. Plain English and ASCII on purpose: it's for us to read, in any language. nil without
-- any error.
function Errors.Report()
  local list = rows()
  if #list == 0 then return nil end
  local client = "?"
  if _G.GetBuildInfo then
    local ok, v, build = pcall(GetBuildInfo)
    if ok and v then client = tostring(v) .. (build and ("." .. tostring(build)) or "") end
  end
  local locale = (_G.GetLocale and GetLocale()) or "?"
  local text = ns.lang and ns.lang.locale
  local head = string.format("Lore Forever %s, WoW %s, %s%s, %s", addonVersion(), client, tostring(locale),
    (text and text ~= locale) and (", text " .. tostring(text)) or "", Errors.source and ("via " .. Errors.source) or "no handler")
  -- Willo's version and the newest version known (Updates.lua), so a report from an old version says so at once.
  local more = ns.Updates and ns.Updates.ReportParts and ns.Updates.ReportParts() or {}
  if #more > 0 then head = head .. ", " .. table.concat(more, ", ") end
  local out = { head, string.format("%d Lua error%s, most recent first:", #list, #list == 1 and "" or "s") }
  local size, shown = #head + #out[2], 0
  for i = #list, 1, -1 do
    local e = list[i]
    local block = string.format("\n%d. %dx, last %s, first %s (%s)\n%s%s", #list - i + 1, tonumber(e.n) or 1,
      when(e.last), when(e.first), tostring(e.v or "?"), tostring(e.msg), e.stack and ("\n" .. e.stack) or "")
    if size + #block > REPORT_LETTERS and shown > 0 then
      out[#out + 1] = string.format("\n(%d older not shown)", i)
      break
    end
    out[#out + 1] = block
    size, shown = size + #block + 1, shown + 1
  end
  return table.concat(out, "\n")
end
