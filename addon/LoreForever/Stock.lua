-- What a goal counts (LOR-665, Willo's goals): the character's gold, experience, profession ranks, riding and
-- reputation as they stand, and a line for each day played, kept in the journey's record for Willo's app to read
-- (companion/lore_companion/journal.py), so "how close am I to my mount?" has the real numbers and a pace. Nothing of
-- it shows in the game, and it only reads what the game tells the add-on. It's taken at login and when the game saves
-- (logout and /reload: Journey.lua's PLAYER_LOGOUT), so it costs nothing while you play, and only with "Remember my
-- journey" on.
--
-- char.stock = { t, level, xp, xpMax, money (copper), riding (0, 75 or 150), skills = { [name] = { rank, max } },
--   (skills by the profession's English name in every client language, the client's own third when it differs:
--   { rank, max, "Bergbau" }, so Willo, who answers in English, finds them in a German or Spanish save)
--   rep = { [faction] = { standing 1-8, value, min, max } },   reputations moved from a plain Neutral, by the game's
--   own bar (value from min to max of the standing)
--   gear = { [slot 1-19] = { itemID, name, rune } },   what they wear (rune: the rune engraved on it, where the game has
--   runes), for "what should I upgrade?" and "am I ready for this dungeon?" (LOR-834)
--   talents = { { name = tree, points, ranks = { [talent] = rank } } },   each tree's points and the talents taken
--   bags = { [itemID] = { count, name } } }   what's in their bags (BAGS_MAX kinds at most), for "do I have enough?"
-- Never their buffs: a buff saved at logout is hours stale by the next question.
-- char.days = { { d = "2026-10-18", m0, m, l0, l, on }, ... }   the last DAYS days played, oldest first: money and level
--   (with the bar's fraction, 36.6) at the day's first look and its last, and seconds online that day (a session that
--   runs past midnight stays on the day it started)

local _, ns = ...
local Stock = {}
ns.Stock = Stock

local DAYS = 14
local BAGS_MAX = 150    -- kinds of item kept from the bags (the site keeps as many)
-- Forever's riding (its client: SkillLineAbility, riding's skill line 762): Journeyman Riding, then Apprentice.
local RIDING = { { 33391, 150 }, { 33388, 75 } }
local session        -- { day, from }: this session's line in char.days, and when it started counting online

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end
local function number(v)
  v = tonumber(v)
  return v and ns.Context.Usable(v) and v or nil
end

local function riding()
  for _, r in ipairs(RIDING) do
    if try(IsSpellKnown, r[1]) or try(IsPlayerSpell, r[1]) then return r[2] end
  end
  return 0
end

-- The professions as the other client languages name them (deDE, frFR, esES and esMX, ptBR, ruRU, itIT), to their
-- English names. A name not here (a new profession, another language) stays as the game gave it.
local PROFESSION_NAMES = {
  ["Alchemy"] = { "Alchimie", "Alquimia", "Алхимия", "Alchimia" },
  ["Blacksmithing"] = { "Schmiedekunst", "Forge", "Herrería", "Ferraria", "Кузнечное дело", "Forgiatura" },
  ["Enchanting"] = { "Verzauberkunst", "Enchantement", "Encantamiento", "Encantamento", "Наложение чар", "Incantamento" },
  ["Engineering"] = { "Ingenieurskunst", "Ingénierie", "Ingeniería", "Engenharia", "Инженерное дело", "Ingegneria" },
  ["Herbalism"] = { "Kräuterkunde", "Herboristerie", "Herboristería", "Herborismo", "Травничество", "Erbalismo" },
  ["Leatherworking"] = { "Lederverarbeitung", "Travail du cuir", "Peletería", "Couraria", "Кожевничество", "Conciatura" },
  ["Mining"] = { "Bergbau", "Minage", "Minería", "Mineração", "Горное дело", "Estrazione" },
  ["Skinning"] = { "Kürschnerei", "Dépeçage", "Desuello", "Esfolamento", "Снятие шкур", "Scuoiatura" },
  ["Tailoring"] = { "Schneiderei", "Couture", "Sastrería", "Alfaiataria", "Портняжное дело", "Sartoria" },
  ["Cooking"] = { "Kochkunst", "Cuisine", "Cocina", "Culinária", "Кулинария", "Cucina" },
  ["First Aid"] = { "Erste Hilfe", "Secourisme", "Primeros auxilios", "Primeiros Socorros", "Первая помощь", "Primo Soccorso" },
  ["Fishing"] = { "Angeln", "Pêche", "Pesca", "Рыбная ловля" },
}
local ENGLISH_NAME = {}
for english, names in pairs(PROFESSION_NAMES) do
  ENGLISH_NAME[english:lower()] = english
  for _, n in ipairs(names) do ENGLISH_NAME[n:lower()] = english end
end

local function skills()
  local out = {}
  for _, p in ipairs(ns.Context.Professions()) do
    local rank = number(p.rank)
    if ns.Context.Usable(p.name) and type(p.name) == "string" and rank then
      local english = ENGLISH_NAME[p.name:lower()]
      out[english or p.name] = { rank, number(p.max) or rank, english and english ~= p.name and p.name or nil }
    end
  end
  return out
end

local function reputations()
  local out = {}
  for _, f in ipairs(ns.Journey.Factions and ns.Journey.Factions() or {}) do
    local v, lo, hi = number(f.v), number(f.lo), number(f.hi)
    if v and lo and hi and not (f.st == 4 and v <= 0) then out[f.name] = { f.st, v, lo, hi } end
  end
  return out
end

-- Every value a call returns (try keeps two), or nothing when it errors.
local function all(fn, ...)
  if type(fn) ~= "function" then return end
  local r = { pcall(fn, ...) }
  if r[1] then return unpack(r, 2) end
end
local function itemName(id, link)
  local name = _G.C_Item and try(C_Item.GetItemNameByID, id) or try(GetItemInfo, id)
  if not name and type(link) == "string" then name = link:match("%[(.-)%]") end
  return ns.Context.Usable(name) and type(name) == "string" and name or nil
end

local function gear()
  local out, engraving = {}, _G.C_Engraving
  for slot = 1, 19 do
    local id = number(try(GetInventoryItemID, "player", slot))
    if id then
      local rune = engraving and try(engraving.GetRuneForEquipmentSlot, slot)
      rune = type(rune) == "table" and ns.Context.Usable(rune.name) and type(rune.name) == "string" and rune.name or nil
      out[slot] = { id, itemName(id, try(GetInventoryItemLink, "player", slot)) or "", rune }
    end
  end
  return out
end

-- Forever's talents live in the game's Trait API, which its own Talents window reads. The older calls below give nothing
-- there: on 11/9 not one of the 891 characters at level 10 or more had saved a talent. The window sets three trees side
-- by side, so a node's position says which tree it's in; the name is the game's where it gives one.
local TREE_COLUMNS = { 4000, 8000 }
local CLASS_TREE_NODES = 30   -- a class tree's size at least: a character's other trees (Legacy) are small

local function treeName(column)
  for _, v in ipairs({ all(GetTalentTabInfo, column) }) do
    if type(v) == "string" and ns.Context.Usable(v) then return v end
  end
  return "Tree " .. column
end

local function spellName(id)
  local name = _G.C_Spell and try(C_Spell.GetSpellName, id) or try(GetSpellInfo, id)
  return type(name) == "string" and ns.Context.Usable(name) and name or nil
end

-- The talents taken, as talents() has them; nil when this client has no Trait talents to read yet.
local function traitTalents()
  local traits, class = _G.C_Traits, _G.C_ClassTalents
  if not (traits and class) then return nil end
  local config = try(class.GetActiveConfigID)
  local info = config and try(traits.GetConfigInfo, config)
  if type(info) ~= "table" or type(info.treeIDs) ~= "table" then return nil end
  local trees = {}
  for _, treeID in ipairs(info.treeIDs) do
    local nodes = try(traits.GetTreeNodes, treeID)
    if type(nodes) == "table" and #nodes >= CLASS_TREE_NODES then
      for _, nodeID in ipairs(nodes) do
        local node = try(traits.GetNodeInfo, config, nodeID)
        local rank = type(node) == "table" and number(node.ranksPurchased) or 0
        local entryID = rank > 0 and type(node.activeEntry) == "table" and node.activeEntry.entryID
        local entry = entryID and try(traits.GetEntryInfo, config, entryID)
        local def = type(entry) == "table" and entry.definitionID and try(traits.GetDefinitionInfo, entry.definitionID)
        local override = type(def) == "table" and ns.Context.Usable(def.overrideName) and def.overrideName
        local name = type(override) == "string" and override ~= "" and override or (type(def) == "table" and spellName(def.spellID))
        if type(name) == "string" then
          local x = number(node.posX) or 0
          local column = x < TREE_COLUMNS[1] and 1 or x < TREE_COLUMNS[2] and 2 or 3
          local tree = trees[column] or { name = treeName(column), points = 0, ranks = {} }
          trees[column] = tree
          tree.ranks[name], tree.points = rank, tree.points + rank
        end
      end
    end
  end
  local out = {}
  for column = 1, 3 do out[#out + 1] = trees[column] end
  return out[1] and out or nil
end

-- Each tree by its name (the first word the game gives for it: older clients start with the name, newer with an id),
-- its points counted from its talents' ranks.
local function talents()
  local fromTraits = traitTalents()
  if fromTraits then return fromTraits end
  local out = {}
  for tab = 1, number(try(GetNumTalentTabs)) or 0 do
    local name
    for _, v in ipairs({ all(GetTalentTabInfo, tab) }) do
      if type(v) == "string" and ns.Context.Usable(v) then name = v break end
    end
    if name then
      local tree = { name = name, points = 0, ranks = {} }
      for i = 1, number(try(GetNumTalents, tab)) or 0 do
        local talent, _, _, _, rank = all(GetTalentInfo, tab, i)
        rank = number(rank)
        if type(talent) == "string" and ns.Context.Usable(talent) and rank and rank > 0 then
          tree.ranks[talent], tree.points = rank, tree.points + rank
        end
      end
      out[#out + 1] = tree
    end
  end
  return out
end

local function bags()
  local out, kinds, CC = {}, 0, _G.C_Container
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    for slot = 1, (CC and try(CC.GetContainerNumSlots, bag)) or try(GetContainerNumSlots, bag) or 0 do
      local info = CC and try(CC.GetContainerItemInfo, bag, slot)
      local id = type(info) == "table" and number(info.itemID)
      if id then
        local have = out[id]
        if not have and kinds < BAGS_MAX then
          kinds = kinds + 1
          have = { 0, itemName(id, info.hyperlink) or (ns.Context.Usable(info.itemName) and info.itemName) or "" }
          out[id] = have
        end
        if have then have[1] = have[1] + (number(info.stackCount) or 1) end
      end
    end
  end
  return out
end

-- The level with the bar's fraction: 36.6 at 60% of the way to 37 (the cap's bar means nothing).
local function levelNow(level, xp, xpMax)
  if level and xp and xpMax and xpMax > 0 and level < 60 then return level + math.min(0.99, xp / xpMax) end
  return level
end

local function dayLine(days, d)
  for i = #days, 1, -1 do
    if type(days[i]) == "table" and days[i].d == d then return days[i] end
  end
end

-- Their talents again, once the game has them (entering the world) and when they change: Willo reads this save.
function Stock.Talents(char)
  if type(char) ~= "table" or type(char.stock) ~= "table" then return end
  local read = talents()
  if #read > 0 then char.stock.talents = read end
end

-- Take stock of the character (char: Journey's record for it). leaving: the game is about to save (logout or
-- /reload), so this session's time goes on its day.
function Stock.Take(char, leaving)
  if type(char) ~= "table" then return end
  local level = number(try(UnitLevel, "player")) or number(char.level)
  local xp, xpMax, money = number(try(UnitXP, "player")), number(try(UnitXPMax, "player")), number(try(GetMoney))
  local now = time()
  -- The game can have no talents to give yet at login and none left at logout: keep what was last read.
  local had = type(char.stock) == "table" and char.stock.talents
  local read = talents()
  char.stock = { t = now, level = level, xp = xp, xpMax = xpMax, money = money, riding = riding(), skills = skills(),
    rep = reputations(), gear = gear(), talents = #read > 0 and read or type(had) == "table" and had or read, bags = bags() }
  local lv = levelNow(level, xp, xpMax)
  char.days = type(char.days) == "table" and char.days or {}
  local days = char.days
  local line = leaving and session and dayLine(days, session.day)
  if not line then
    local d = date("%Y-%m-%d", now)
    line = dayLine(days, d)
    if not line then
      line = { d = d, m0 = money, l0 = lv, on = 0 }
      days[#days + 1] = line
    end
  end
  line.m, line.l = money, lv
  if leaving then
    if session then line.on = math.floor((tonumber(line.on) or 0) + math.max(0, now - session.from)) end
    session = nil
  else
    session = { day = line.d, from = now }
  end
  while #days > DAYS do table.remove(days, 1) end
end
