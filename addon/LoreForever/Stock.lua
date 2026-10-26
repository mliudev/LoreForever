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

-- Each tree by its name (the first word the game gives for it: older clients start with the name, newer with an id),
-- its points counted from its talents' ranks.
local function talents()
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

-- Take stock of the character (char: Journey's record for it). leaving: the game is about to save (logout or
-- /reload), so this session's time goes on its day.
function Stock.Take(char, leaving)
  if type(char) ~= "table" then return end
  local level = number(try(UnitLevel, "player")) or number(char.level)
  local xp, xpMax, money = number(try(UnitXP, "player")), number(try(UnitXPMax, "player")), number(try(GetMoney))
  local now = time()
  char.stock = { t = now, level = level, xp = xp, xpMax = xpMax, money = money, riding = riding(), skills = skills(),
    rep = reputations(), gear = gear(), talents = talents(), bags = bags() }
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
