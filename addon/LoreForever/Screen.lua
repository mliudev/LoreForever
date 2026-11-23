-- Where the game's own frames sit on the screen (LOR-802), kept in the journey's record for Willo's app to read
-- (companion/lore_companion/journal.py). With Live game info off she reads the place name by the minimap and the target
-- frame off her picture of the game: these say where to look on any layout (the default one, frames moved in Edit Mode,
-- ElvUI) instead of guessing from one player's screen. What the action bars hold is Stock.lua's (bars, by name). Nothing
-- of it shows in the game, and it only reads what the game tells the add-on. Taken as the game saves (logout and
-- /reload: Journey.lua's PLAYER_LOGOUT), with "Remember my journey" on, so it costs nothing while you play.
--
-- char.screen = { t, scale = UIParent's effective scale,
--   frames = { [part] = { left, top, right, bottom } }   fractions of the screen, from its top-left corner (0 to 1)
--   from = { [part] = the frame's name } }   whose look it has ("TargetFrame": the game's own green health bar)

local _, ns = ...
local Screen = {}
ns.Screen = Screen

-- Each part, by the frames that can show it, the first one the game has winning: ElvUI's, then the game's own.
local PARTS = {
  minimap = { "ElvUI_MinimapHolder", "Minimap" },
  zone = { "MinimapZoneText", "MinimapCluster.ZoneTextButton", "MinimapCluster.BorderTop" },
  target = { "ElvUF_Target", "TargetFrame" },
  focus = { "ElvUF_Focus", "FocusFrame" },
  -- Another add-on's own frame before the game's, which it hides (TalkMark.lua's list for the target): Willo cuts her
  -- close-up of who they are from this spot (LOR-1525).
  player = { "ElvUF_Player", "SUFUnitplayer", "PitBull4_Frames_Player", "XPerl_Player", "LUFUnitplayer", "oUF_Player",
    "PlayerFrame" },
  tracker = { "ObjectiveTrackerFrame", "QuestWatchFrame", "WatchFrame" },
  chat = { "ChatFrame1" },
}
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then return a, b, c, d end
end

-- A frame by its global name, or a child's path from one ("MinimapCluster.ZoneTextButton").
local function frame(path)
  local f = _G
  for part in path:gmatch("[^%.]+") do
    f = type(f) == "table" and f[part] or nil
  end
  return type(f) == "table" and f or nil
end

local function number(v)
  return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge and v or nil
end
local function round(v) return math.floor(v * 10000 + 0.5) / 10000 end

-- f's rectangle as fractions of the screen (W, H: UIParent's size in its own effective scale's units).
local function rect(f, W, H, uiScale)
  if not (f.GetRect and f.GetEffectiveScale) then return nil end
  local l, b, w, h = try(f.GetRect, f)
  local s = number(try(f.GetEffectiveScale, f))
  l, b, w, h = number(l), number(b), number(w), number(h)
  if not (l and b and w and h and s) or s <= 0 or w <= 0 or h <= 0 then return nil end
  s = s / uiScale
  local left, right, top, bottom = l * s / W, (l + w) * s / W, 1 - (b + h) * s / H, 1 - b * s / H
  if right <= 0 or bottom <= 0 or left >= 1 or top >= 1 then return nil end   -- off the screen
  return { round(math.max(0, left)), round(math.max(0, top)), round(math.min(1, right)), round(math.min(1, bottom)) }
end

-- Take where the frames are (char: Journey's record for the character).
function Screen.Take(char)
  if type(char) ~= "table" or type(UIParent) ~= "table" then return end
  local W, H = number(try(UIParent.GetWidth, UIParent)), number(try(UIParent.GetHeight, UIParent))
  local uiScale = number(try(UIParent.GetEffectiveScale, UIParent))
  if not (W and H and uiScale) or W <= 0 or H <= 0 or uiScale <= 0 then return end
  local frames, from = {}, {}
  for part, names in pairs(PARTS) do
    for _, name in ipairs(names) do
      local f = frame(name)
      local r = f and rect(f, W, H, uiScale)
      if r then frames[part], from[part] = r, name; break end
    end
  end
  char.screen = { t = time(), scale = round(uiScale), frames = frames, from = from }
end
