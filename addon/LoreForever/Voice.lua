-- Read lore aloud: narrated MP3 intros for the most-visited places, the game's text-to-speech for everything else,
-- and optional narration of each zone while on a flight.
-- The TTS API has changed shape across client versions, so every call is tried defensively.

local _, ns = ...
local Voice = {}
ns.Voice = Voice
local L = ns.L

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end

-- /lore debug: log every speech call and speech event to chat, for diagnosing TTS on a new client.
local function dbg(...)
  if not ns.debug then return end
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  DEFAULT_CHAT_FRAME:AddMessage("|cff88ccffLore Forever TTS:|r " .. table.concat(parts, " "))
end
Voice.dbg = dbg

-- Colour codes, hyperlinks and escaped pipes shouldn't be read out.
function Voice.Plain(text)
  return (tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|H.-|h(.-)|h", "%1")
    :gsub("||", "|"):gsub("%s+", " "))
end

-- Reading another language, an English voice mangles the text. The language pack names voices that speak it
-- (X-LoreForever-TTSVoices: "German|Deutsch|Hedda"): keep the player's voice if it's one of them, else take the
-- first installed one that is, else keep theirs and say once how to get one.
local function speaks(v, hints)
  local name = ns.Engine.lower(v and v.name or "")
  for _, h in ipairs(hints) do
    if name:find(h, 1, true) then return true end
  end
end
function Voice.ForLanguage(voice, voices)
  local hints = ns.lang and ns.lang.ttsVoices
  if not (hints and hints[1]) or speaks(voice, hints) then return voice end
  for _, v in ipairs(voices or {}) do
    if speaks(v, hints) then return v end
  end
  if not Voice.warnedVoice then
    Voice.warnedVoice = true
    DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. string.format(
      ns.L["no %s voice is installed for Read aloud, so your game voice reads the text. Add one in your system's speech settings."],
      ns.lang.name or ""))
  end
  return voice
end

-- The voice, speed and volume the player picked in Options > Accessibility > Text to Speech, falling back to the
-- first installed voice at normal speed. Returns voiceID, voice table, rate, volume.
local function voiceSettings()
  local VC, TS = _G.C_VoiceChat, _G.C_TTSSettings
  local voices
  if VC and VC.GetTtsVoices then
    local ok, v = pcall(VC.GetTtsVoices)
    if ok and type(v) == "table" then voices = v end
  end
  local id
  if TS and TS.GetVoiceOptionID and _G.Enum and Enum.TtsVoiceType then
    local ok, v = pcall(TS.GetVoiceOptionID, Enum.TtsVoiceType.Standard)
    if ok then id = v end
  end
  local voice
  for _, v in ipairs(voices or {}) do
    if v.voiceID == id then voice = v end
  end
  voice = voice or (voices and voices[1])
  voice = Voice.ForLanguage(voice, voices)
  local rate, volume = 0, 100
  if TS and TS.GetSpeechRate then
    local ok, r = pcall(TS.GetSpeechRate)
    if ok and r then rate = r end
  end
  if TS and TS.GetSpeechVolume then
    local ok, v = pcall(TS.GetSpeechVolume)
    if ok and v then volume = v end
  end
  return voice and voice.voiceID, voice, rate, volume
end

-- The game's text-to-speech exists and the player hasn't turned "Read aloud" off.
function Voice.Available()
  if S().readAloud == false then return false end
  local VC = _G.C_VoiceChat
  return (_G.TextToSpeech_Speak ~= nil) or (VC ~= nil and VC.SpeakText ~= nil)
end

-- Recorded narration comes from voice packs (see Packs.lua). The player keeps an ordered list of voices (voiceOrder,
-- with "auto" standing for the default pack of the reading language) and can untick some (voiceOff). Each clip plays
-- from the first ticked voice that has a current recording of it, then nothing (the caller falls back to
-- text-to-speech). A pack's clip is used only while it was recorded from the current text (its hash matches
-- ns.DB.clipHash), so a recording never contradicts the page. Packs are partial: most cover only some clips.
local DEFAULT_PACK = "LoreForever_Voice_Default"
-- Where players get voice packs (the site's Downloads page). Players type it, so keep it short.
Voice.DOWNLOADS = "loreforeverwow.com/downloads"
local AUTO = "auto"
local LANGUAGES = { enUS = "English", enGB = "English", deDE = "Deutsch", frFR = "Français", esES = "Español",
  esMX = "Español (Latinoamérica)", ptBR = "Português", itIT = "Italiano", ruRU = "Русский", koKR = "한국어",
  zhCN = "简体中文", zhTW = "繁體中文" }

local function readingLocale() return ns.readingLocale or "enUS" end
-- Same language, whatever the region: enGB recordings suit English text (the clip hashes still decide per clip).
local function sameLanguage(a, b) return (a or "enUS"):sub(1, 2) == (b or "enUS"):sub(1, 2) end
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end

Voice.active, Voice.chain, Voice.stats, Voice.total, Voice.provided, Voice.servedBy = {}, {}, {}, 0, {}, {}
Voice.questPaths, Voice.questServed = {}, {}   -- quest dialogue picked for an open quest window (Voice.QuestClip)

-- Put a voice first in the list and tick it, along with the default voice (what choosing a voice always meant: that
-- voice, then the default for the rest). "none" unticks every voice.
local function apply(s, value)
  if value == "none" then
    for _, k in ipairs(s.voiceOrder) do s.voiceOff[k] = true end
    return
  end
  for i = #s.voiceOrder, 1, -1 do
    if s.voiceOrder[i] == value then table.remove(s.voiceOrder, i) end
  end
  table.insert(s.voiceOrder, 1, value)
  s.voiceOff[value], s.voiceOff[AUTO] = nil, nil
end

-- The voice settings, set up on first use. Installs from before the list saved one voice (voicePack): it becomes
-- the top of the list, and Voice.migrated tells Init to add the other installed voices quietly at the bottom.
local function prefs()
  local s = S()
  local created = false
  if type(s.voiceOrder) ~= "table" then s.voiceOrder, created = {}, true end
  if type(s.voiceOff) ~= "table" then s.voiceOff = {} end
  -- A saved list with holes, repeats or junk in it (edited by hand, an old bug) becomes a plain list of names.
  local idx, clean, seen = {}, {}, {}
  for i, k in pairs(s.voiceOrder) do
    if type(i) == "number" and type(k) == "string" then idx[#idx + 1] = i end
  end
  table.sort(idx)
  for _, i in ipairs(idx) do
    local k = s.voiceOrder[i]
    if not seen[k] then seen[k], clean[#clean + 1] = true, k end
  end
  if not seen[AUTO] then clean[#clean + 1] = AUTO end   -- the default voice always has a place
  s.voiceOrder = clean
  if s.voicePack ~= nil then
    local old = s.voicePack
    s.voicePack = nil
    apply(s, old)
    if created then Voice.migrated = true end
  end
  return s
end

-- The voice the old one-voice picker shows: the first ticked one in the list ("auto", a pack name), or "none".
function Voice.Current()
  local s = prefs()
  for _, k in ipairs(s.voiceOrder) do
    if not s.voiceOff[k] then return k end
  end
  return "none"
end

-- Where a pack keeps a clip: zone:stormwind -> Audio\zone_stormwind.mp3, zone:stormwind#faq3 -> ...__faq3.mp3,
-- quest:176#detail -> ...\quest_176__detail.mp3 (lore.clips.stem).
function Voice.ClipPath(pack, id, ext)
  local stem = (id:gsub("#", "__"):gsub("[^%w%-_]", "_"))
  return "Interface\\AddOns\\" .. pack .. "\\Audio\\" .. stem .. "." .. (ext or "mp3")
end

-- The default pack for a language: LoreForever_Voice_Default_<locale>, or LoreForever_Voice_Default for its language.
function Voice.DefaultPack(locale)
  locale = locale or readingLocale()
  for _, name in ipairs({ DEFAULT_PACK .. "_" .. locale, DEFAULT_PACK }) do
    local rec = ns.Packs.Get(name)
    if rec and sameLanguage(rec.locale, locale) then return name end
  end
end

local function isDefault(name) return name:sub(1, #DEFAULT_PACK) == DEFAULT_PACK end

-- Why a pack can't narrate right now, in words, and the reason code ("MISSING", a Packs reason, or "LANGUAGE"); nil
-- if it can. Compare the code, not the words: they're translated.
function Voice.Unusable(name)
  local rec = ns.Packs.Get(name)
  if not rec then return L["Not installed"], "MISSING" end
  if rec.loadable == false then return ns.Packs.ReasonText(rec.reason) or L["Can't load"], rec.reason end
  if rec.locale and not sameLanguage(rec.locale, readingLocale()) then
    return string.format(L["Recorded in %s"], rec.languageName or LANGUAGES[rec.locale] or rec.locale), "LANGUAGE"
  end
end

-- Load a pack if it can be used; returns what it registered. Packs can't load in combat (e.g. a /reload mid-fight):
-- that's remembered and retried when combat ends.
local function ensure(name)
  if not name or Voice.Unusable(name) then return nil end
  local data, reason = ns.Packs.Load(name)
  if reason == "COMBAT" then Voice.deferred = true end
  if data and not Voice.Unusable(name) then return data end   -- the language may only be known once loaded
end

-- Installed lands packs that add clips to a voice (## X-LoreForever-Extends: <name>), in name order. A lands pack is
-- never a voice of its own, and one whose voice isn't installed or chosen simply isn't used.
-- A lands pack's folder starts with its voice's (LoreForever_Voice_Female_Horde): some clients can't read an add-on's
-- X- fields before it's loaded, so a pack named that way is loaded to find out.
function Voice.Extensions(name)
  local out = {}
  for _, rec in ipairs(ns.Packs.List("voice")) do
    if not rec.extends and rec.name:sub(1, #name + 1) == name .. "_" and not ns.Packs.IsLoaded(rec.name) then
      ensure(rec.name)
    end
    if rec.extends and rec.extends == name then out[#out + 1] = rec.name end
  end
  table.sort(out)
  return out
end

-- A voice and its loaded lands packs: the packs whose clips speak in that voice.
local function withExtensions(name)
  local out = { name }
  for _, ext in ipairs(Voice.Extensions(name)) do
    if ensure(ext) then out[#out + 1] = ext end
  end
  return out
end

-- Current and stale clip counts for a loaded pack, its lands packs included.
function Voice.Count(name)
  local hashes, have, stale = (ns.DB and ns.DB.clipHash) or {}, 0, 0
  for _, pack in ipairs(withExtensions(name)) do
    local data = ns.Packs.data[pack]
    for id, h in pairs(data and data.clips or {}) do
      if hashes[id] == h then have = have + 1 elseif hashes[id] then stale = stale + 1 end
    end
  end
  return have, stale
end

-- The clip a voice should keep together with this one (voiceGroup): its story's main clip ("story": the entry, for
-- its #faq clips), its zone's story ("zone": a zone's places and people follow it), or none ("line").
local function storyOf(id) return id:match("^(.-)#faq%d+$") or id end
local function anchorOf(id, mode)
  if mode == "story" then return storyOf(id) end
  if mode == "zone" then
    local e = ns.DB and ns.DB.entries and ns.DB.entries[storyOf(id)]
    return e and e.z and ("zone:" .. e.z) or storyOf(id)
  end
end

-- The races a voice suits, as a set, from its .toc (## X-LoreForever-Races: Orc, Troll). Names are matched loosely
-- ("Night Elf" = nightelf), and "undead" means the Forsaken, as data/clips.json names them.
local RACE_ALIAS = { undead = "forsaken", scourge = "forsaken" }
function Voice.Races(name)
  local rec, out = ns.Packs.Get(name), {}
  for word in tostring(rec and rec.races or ""):gmatch("[^,;/]+") do
    local race = word:lower():gsub("[^%a]", "")
    if race ~= "" then out[RACE_ALIAS[race] or race] = true end
  end
  return out
end

-- The pack behind a key in the list: "auto" is the default pack for the reading language (nil if there's none).
local function packOf(key)
  if key == AUTO then return Voice.DefaultPack() end
  return key
end

-- Rebuild Voice.active (clip id -> the paths to try, in order) from the voice list. Each voice in the chain brings
-- its installed lands packs; their counts go to the voice they extend. For each clip the voices with a current
-- recording are ranked in list order, except that the voice playing the clip's anchor (anchorOf) goes first when it
-- has the clip too, so a story's questions don't switch narrator. The rest stay behind it as fallbacks for a file
-- that won't play. Voice.servedBy[id] is the voice that plays a clip; Voice.stats[voice] = {have, stale, plays}.
-- Voice.provided marks every clip some pack in the chain has (current or not), for the "narrated in a pack you
-- don't have" hint.
function Voice.Refresh()
  local s = prefs()
  Voice.deferred = nil
  local chain, packsOf = {}, {}
  for _, key in ipairs(s.voiceOrder) do
    local name = packOf(key)
    if name and not s.voiceOff[key] and not packsOf[name] and ensure(name) then
      chain[#chain + 1] = name
      packsOf[name] = withExtensions(name)
    end
  end
  local stats, total, provided, ranked = {}, 0, {}, {}
  for _, name in ipairs(chain) do stats[name] = { have = 0, stale = 0, plays = 0 } end
  for id, hash in pairs((ns.DB and ns.DB.clipHash) or {}) do
    total = total + 1
    for _, name in ipairs(chain) do
      local paths
      for _, pack in ipairs(packsOf[name]) do
        local data = ns.Packs.data[pack]
        local h = data and data.clips[id]
        if h then provided[id] = true end
        if h == hash then
          paths = paths or {}
          paths[#paths + 1] = Voice.ClipPath(pack, id, data.ext)
        elseif h then
          stats[name].stale = stats[name].stale + 1
        end
      end
      if paths then
        stats[name].have = stats[name].have + 1
        ranked[id] = ranked[id] or {}
        table.insert(ranked[id], { name, paths })
      end
    end
  end
  -- "Prefer voices that suit the race": for a clip whose story belongs to a race (ns.DB.clipNarrator), the voices
  -- that name that race go first, still in list order among themselves.
  local narrators = s.voiceMatchRace and ns.DB and ns.DB.clipNarrator
  if narrators then
    local suits = {}
    for _, name in ipairs(chain) do suits[name] = Voice.Races(name) end
    for id, list in pairs(ranked) do
      local race = narrators[id]
      if race and #list > 1 then
        local yes, no = {}, {}
        for _, voice in ipairs(list) do
          table.insert(suits[voice[1]][race] and yes or no, voice)
        end
        for _, voice in ipairs(no) do yes[#yes + 1] = voice end
        ranked[id] = yes
      end
    end
  end
  local mode, first = s.voiceGroup or "story", {}
  for id, list in pairs(ranked) do first[id] = list[1][1] end
  local active, servedBy = {}, {}
  for id, list in pairs(ranked) do
    local anchor = anchorOf(id, mode)
    local keep = anchor and anchor ~= id and first[anchor]
    if keep and keep ~= list[1][1] then
      for i = 2, #list do
        if list[i][1] == keep then table.insert(list, 1, table.remove(list, i)) break end
      end
    end
    local paths = {}
    for _, voice in ipairs(list) do
      for _, p in ipairs(voice[2]) do paths[#paths + 1] = p end
    end
    active[id], servedBy[id] = paths, list[1][1]
    stats[list[1][1]].plays = stats[list[1][1]].plays + 1
  end
  -- Quest dialogue (ns.DB.questClip: quest:<id>#detail|progress|complete, from the voices' quest packs): each voice
  -- in the chain with a current recording, in list order. Voice.QuestClip picks one when a quest window opens.
  local questRanked = {}
  for id, hash in pairs((ns.DB and ns.DB.questClip) or {}) do
    for _, name in ipairs(chain) do
      for _, pack in ipairs(packsOf[name]) do
        local data = ns.Packs.data[pack]
        if data and data.clips[id] == hash then
          questRanked[id] = questRanked[id] or {}
          table.insert(questRanked[id], { name, Voice.ClipPath(pack, id, data.ext) })
          break
        end
      end
    end
  end
  Voice.questRanked = questRanked
  -- Recordings outside the voice packs (journey chapters the companion app narrated: Journey.LoadChapters).
  for id, paths in pairs(Voice.extra or {}) do active[id], servedBy[id] = paths, nil end
  Voice.active, Voice.chain, Voice.stats, Voice.total, Voice.ready = active, chain, stats, total, true
  Voice.provided, Voice.servedBy = provided, servedBy
end

-- The voice (its pack name) that plays a clip and the file it plays first, or nil if no voice has the clip.
function Voice.Resolve(id)
  if not Voice.ready then Voice.Refresh() end
  local paths = Voice.active[id] or Voice.questPaths[id]
  return Voice.servedBy[id] or Voice.questServed[id], paths and paths[1]
end

-- Voices installed since the last login go to the top of the list (installing one means you want to hear it; a
-- partial pack only takes over the clips it has), with a line in chat. After moving from the one-voice setting
-- they're added unticked at the bottom instead, so nothing changes for the player. A voice that can't be used
-- (another language, disabled, too new) goes to the bottom without a word, to show greyed in the list. Lands packs
-- aren't voices. A pack combat kept from loading waits for OnCombatEnded; returns true if one did.
local function adoptNew(quiet)
  local s = prefs()
  local known, voices, new, unusable, waiting = {}, ns.Packs.List("voice"), {}, {}, false
  for _, k in ipairs(s.voiceOrder) do known[k] = true end
  local function lands(rec)
    if rec.extends then return true end
    for _, o in ipairs(voices) do
      if o.name ~= rec.name and rec.name:sub(1, #o.name + 1) == o.name .. "_" then return true end
    end
  end
  for _, rec in ipairs(voices) do
    if not isDefault(rec.name) and not known[rec.name] then
      if Voice.Unusable(rec.name) then
        if not lands(rec) then unusable[#unusable + 1] = rec end
      elseif ensure(rec.name) then
        rec = ns.Packs.Get(rec.name)   -- its X- fields may only be readable now it's loaded
        if not lands(rec) then new[#new + 1] = rec end
      else
        waiting = true
      end
    end
  end
  if quiet then
    for _, list in ipairs({ new, unusable }) do
      for _, rec in ipairs(list) do
        s.voiceOrder[#s.voiceOrder + 1] = rec.name
        s.voiceOff[rec.name] = true
      end
    end
    return waiting
  end
  for _, rec in ipairs(unusable) do s.voiceOrder[#s.voiceOrder + 1] = rec.name end
  for i = #new, 1, -1 do table.insert(s.voiceOrder, 1, new[i].name) end
  for _, rec in ipairs(new) do
    local have = Voice.Count(rec.name)
    say(string.format(L["new voice: %s. It plays first now; you can change the order in Options."],
      string.format(have == 1 and L["%s (%d narration)"] or L["%s (%d narrations)"], rec.title, have)))
  end
  return waiting
end

-- Look for new voices (adoptNew), then rebuild. A move from the one-voice setting stays quiet until the voices it
-- adds could all load, and a pack combat kept waiting keeps Voice.deferred set for OnCombatEnded.
local function adoptAndRefresh()
  local waiting = adoptNew(Voice.migrated)
  if not waiting then Voice.migrated = nil end
  Voice.Refresh()
  Voice.deferred = Voice.deferred or waiting
end

-- Entering a zone with narrated places or people that no installed pack has (they're in a lands pack): say where to
-- get them, once per zone per session, unless narration is off or the hint is turned off in Options.
Voice.hinted = {}
function Voice.OnZone(zk)
  if not zk or Voice.hinted[zk] or S().packHints == false or Voice.Current() == "none" then return end
  if not Voice.ready then Voice.Refresh() end
  local db = ns.DB or {}
  local zone = db.zones and db.zones[zk]
  if not zone or not Voice.chain[1] then return end
  local missing = false
  for id in pairs(db.clipHash or {}) do
    local e = db.entries and db.entries[id:match("^(.-)#faq%d+$") or id]
    if e and e.z == zk and not Voice.provided[id] then missing = true break end
  end
  if not missing then return end
  Voice.hinted[zk] = true
  local lands = (zone.fa == "alliance" and L["Alliance lands"]) or (zone.fa == "horde" and L["Horde lands"])
    or L["Alliance or Horde lands"]
  say(string.format(L["%s's places and people are narrated in the %s pack: %s"], zone.n, lands, Voice.DOWNLOADS))
end

-- A pack's name for players when it isn't installed (no title to read): LoreForever_Voice_Female_Horde -> "Female Horde".
function Voice.PackName(name)
  local rec = ns.Packs.Get(name)
  if rec and rec.title then return rec.title end
  local short = tostring(name or ""):gsub("^LoreForever_Voice_", ""):gsub("_", " ")
  return short
end

-- Say once if the saved voice can't be used (the saved choice is kept, so reinstalling it brings it back).
-- A missing pack also says where to get it: CurseForge carries only the main download, so a CurseForge update
-- removes voice packs that came from elsewhere, and the add-on would otherwise fall back without a word (LOR-136).
local function noticeMissing()
  local choice = Voice.Current()
  if not choice or choice == "auto" or choice == "none" or Voice.chain[1] == choice then return end
  local why, code = Voice.Unusable(choice)
  local title = Voice.PackName(choice)
  -- What plays instead: the default voice, Read aloud, nothing, or the next voice in the list (named).
  local nextVoice = Voice.chain[1]
  local fallback = (nextVoice and isDefault(nextVoice) and 1) or (nextVoice and 4) or (Voice.Available() and 2) or 3
  local nextTitle = nextVoice and Voice.PackName(nextVoice)
  if code == "MISSING" then
    say(string.format(({ L["voice pack %s isn't installed; using the default voice."],
      L["voice pack %s isn't installed; using Read aloud."],
      L["voice pack %s isn't installed; using no narration."],
      L["voice pack %s isn't installed; using %s."] })[fallback], title, nextTitle))
    say(string.format(L["Get it again at %s, then type /reload."], Voice.DOWNLOADS))
  elseif why then
    say(string.format(({ L["voice pack %s can't be used: %s; using the default voice."],
      L["voice pack %s can't be used: %s; using Read aloud."],
      L["voice pack %s can't be used: %s; using no narration."],
      L["voice pack %s can't be used: %s; using %s."] })[fallback], title, why, nextTitle))
  else
    say(string.format(({ L["voice pack %s didn't load; using the default voice."],
      L["voice pack %s didn't load; using Read aloud."],
      L["voice pack %s didn't load; using no narration."],
      L["voice pack %s didn't load; using %s."] })[fallback], title, nextTitle))
  end
end

-- At login: find the installed packs and load the chosen voice.
function Voice.Init()
  if not next(ns.Packs.registry) then ns.Packs.Scan() end
  prefs()
  adoptAndRefresh()
  if not Voice.deferred then noticeMissing() end
  Voice.CheckSpoken()
  Voice.CheckQuestVoices()
end

-- Combat ended: load the packs that had to wait, then relabel the panel.
function Voice.OnCombatEnded()
  if not Voice.deferred then return end
  adoptAndRefresh()
  noticeMissing()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
end

-- A recorded narration exists for this entry with the current voice (or quest dialogue Voice.QuestClip picked).
function Voice.HasAudio(key)
  if not Voice.ready then Voice.Refresh() end
  return key ~= nil and (Voice.active[key] or Voice.questPaths[key]) ~= nil
end

-- Every clip id the current voice can play (id -> paths), for the Listen tab.
function Voice.Clips()
  if not Voice.ready then Voice.Refresh() end
  return Voice.active
end

-- The choices for Options and /lore voice: Default, each installed voice pack, Game voice only.
-- Loading a voice pack only reads its list of clips, so all of them are loaded here to show their counts.
function Voice.Choices()
  local def = Voice.DefaultPack()
  local defRec = def and ns.Packs.Get(def)
  local out = { { value = "auto", label = defRec and string.format(L["Default (%s)"], defRec.title) or L["Default"],
    note = not def and L["No default voice installed: Read aloud only"] or nil } }
  for _, rec in ipairs(ns.Packs.List("voice")) do
    if not isDefault(rec.name) then ensure(rec.name) end   -- (loading also reads metadata unreadable before it)
    if not isDefault(rec.name) and not rec.extends then   -- lands packs extend a voice; they aren't one
      local why = Voice.Unusable(rec.name)
      local have = not why and Voice.Count(rec.name)
      out[#out + 1] = { value = rec.name, rec = rec, why = why,
        label = have and string.format(have == 1 and L["%s (%d narration)"] or L["%s (%d narrations)"], rec.title, have)
          or rec.title }
    end
  end
  out[#out + 1] = { value = "none", label = L["Game voice only"] }
  return out
end

-- The line under the voice list: how many narrations your voices cover together and what fills the gaps, with the
-- first voice's credit. (Each voice's own counts are on its row: Voice.List.)
function Voice.Status()
  if Voice.Current() == "none" then
    if S().readAloud == false then return L["Recorded narrations are off, and so is Read aloud."] end
    return L["Recorded narrations are off. Read aloud uses the game's voice (Options > Accessibility > Text to Speech)."]
  end
  local lines, first = {}, Voice.chain[1]
  if Voice.deferred then lines[#lines + 1] = L["Some voices load after combat."] end
  if not first then
    lines[#lines + 1] = L["No recorded narrations installed. Read aloud uses the game's voice."]
    return table.concat(lines, " ")
  end
  local covered = 0
  for _ in pairs(Voice.servedBy) do covered = covered + 1 end
  local count = (covered >= Voice.total and L["%d of %d narrations."])
    or (Voice.Available() and L["%d of %d narrations; the rest use Read aloud."])
    or L["%d of %d narrations; the rest show as text only."]
  local rec = ns.Packs.Get(first)
  lines[#lines + 1] = (rec and rec.credit and (rec.credit:gsub("%.$", "") .. ". ") or "")
    .. string.format(count, covered, Voice.total)
  return table.concat(lines, " ")
end

-- The voice list as Options and /lore voice show it, in order. Each row: key (as saved in voiceOrder), name (its
-- pack, or nil when the default voice isn't installed), title, label (as shown), default (the "auto" row), on
-- (ticked), why it can't be used (nil if it can), missing (not installed), have/stale (its current and outdated
-- recordings), plays (how many narrations it plays with the list as it is) and races (its X-LoreForever-Races text,
-- if any). Packs are loaded to count them.
function Voice.List()
  local s, out = prefs(), {}
  for _, key in ipairs(s.voiceOrder) do
    local name = packOf(key)
    local why, code
    if name then why, code = Voice.Unusable(name) else why, code = L["Not installed"], "MISSING" end
    local have, stale = 0, 0
    if not why and ensure(name) then have, stale = Voice.Count(name) end
    local st = name and Voice.stats[name]
    local title = name and Voice.PackName(name)
    out[#out + 1] = { key = key, name = name, title = title or L["Default"],
      label = (key == AUTO and title and string.format(L["Default (%s)"], title)) or title or L["Default"],
      default = key == AUTO, on = not s.voiceOff[key], why = why, missing = code == "MISSING",
      have = have, stale = stale, plays = st and st.plays or 0,
      races = name and ns.Packs.Get(name) and ns.Packs.Get(name).races or nil }
  end
  return out
end

-- Changes to the list take effect at once. In combat, packs that aren't loaded yet join when it ends (Refresh sets
-- Voice.deferred), and the status line says so.
local function listChanged()
  Voice.Refresh()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
end

-- Move a voice up (-1) or down (1) the list. Returns true if it moved.
function Voice.Move(key, delta)
  local order = prefs().voiceOrder
  for i, k in ipairs(order) do
    if k == key then
      local j = i + delta
      if j < 1 or j > #order then return false end
      order[i], order[j] = order[j], order[i]
      listChanged()
      return true
    end
  end
  return false
end

-- Tick or untick a voice.
function Voice.SetOn(key, on)
  prefs().voiceOff[key] = (not on) or nil
  listChanged()
end

-- Take a voice that isn't installed off the list (the default voice always stays). Returns true if it went.
function Voice.Forget(key)
  if key == AUTO or ns.Packs.Get(key) then return false end
  local s = prefs()
  for i = #s.voiceOrder, 1, -1 do
    if s.voiceOrder[i] == key then table.remove(s.voiceOrder, i) end
  end
  s.voiceOff[key] = nil
  listChanged()
  return true
end

-- How voices share a story: "story" (a story and its questions in one voice), "zone" or "line" (see Refresh).
function Voice.SetGroup(mode)
  prefs().voiceGroup = mode
  listChanged()
end

-- Put a voice ("auto", or a pack's add-on name) at the top of the list, ticked along with the default voice, or
-- untick every voice ("none"): what picking in the one-voice picker means. Returns true, or false and why not.
function Voice.SetPack(value)
  if value ~= "auto" and value ~= "none" then
    if InCombatLockdown and InCombatLockdown() then return false, L["Can't switch voice during combat"] end
    ensure(value)
    local why = Voice.Unusable(value) or (not ns.Packs.IsLoaded(value) and L["Didn't load"]) or nil
    if why then return false, why end
  end
  apply(prefs(), value)
  Voice.Refresh()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
  return true
end

-- The voice whose sample is playing (Voice.Preview, by list key), or nil. Options shows Stop on its row; anything
-- that stops playback (Voice.Stop: the player, global Stop, another narration) ends it, and so does the clip ending.
local function setPreview(key)
  if Voice.previewing == key then return end
  Voice.previewing = key
  if ns.Options and ns.Options.OnPreviewChanged then ns.Options.OnPreviewChanged() end
end

local function watchPreview(handle)
  local started = GetTime and GetTime() or 0
  local function check()
    if Voice.handle ~= handle or not Voice.previewing then return end
    local playing
    if _G.C_Sound and C_Sound.IsPlaying then
      local ok, p = pcall(C_Sound.IsPlaying, handle)
      if ok then playing = p end
    end
    -- Clients that can't tell whether a sound plays: give up after a minute and a half (samples are shorter).
    if playing == false or (GetTime and GetTime() or 0) - started > 90 then
      Voice.handle = nil
      setPreview(nil)
    else
      C_Timer.After(0.5, check)
    end
  end
  C_Timer.After(0.5, check)
end

-- Stop a sample that's playing (closing Options, opening the panel); leaves other playback alone.
function Voice.StopPreview()
  if Voice.previewing then Voice.Stop() end
end

-- Play a voice's sample (its X-LoreForever-Sample clip, else its first clip), or a line of the game's voice.
function Voice.Preview(value)
  if ns.UI and ns.UI.StopAll then ns.UI.StopAll() else Voice.Stop() end
  if value == "none" then
    return Voice.Speak(L["This is the game's own voice, from Options, Accessibility, Text to Speech."])
  end
  local name = value == "auto" and Voice.DefaultPack() or value
  local data = ensure(name)
  if not data and value ~= "auto" then   -- the saved voice can't be used: preview the one that actually plays
    name = Voice.DefaultPack()
    data = ensure(name)
  end
  if not data or not _G.PlaySoundFile then return false end
  -- Current clips only, the sample first, then the rest in order, until one plays.
  local rec, hashes, ids = ns.Packs.Get(name), ns.DB.clipHash or {}, {}
  for k, h in pairs(data.clips) do
    if hashes[k] == h and k ~= rec.sample then ids[#ids + 1] = k end
  end
  table.sort(ids)
  if rec.sample and hashes[rec.sample] and data.clips[rec.sample] == hashes[rec.sample] then
    table.insert(ids, 1, rec.sample)
  end
  for i = 1, math.min(#ids, 5) do
    local ok, willPlay, handle = pcall(PlaySoundFile, Voice.ClipPath(name, ids[i], data.ext), "Dialog")
    if ok and willPlay then
      Voice.handle = handle
      setPreview(value)
      watchPreview(handle)
      return true
    end
  end
  return false
end

local function now() return GetTime and GetTime() or 0 end

function Voice.Stop()
  if Voice.handle and _G.StopSound then pcall(StopSound, Voice.handle) end
  Voice.handle = nil
  local hadSpeech = Voice.ttsActive or Voice.pending
  Voice.pending = nil
  -- Only stop speech that's actually ours and running: stopping idle TTS has been seen to swallow what comes next.
  local VC = _G.C_VoiceChat
  if hadSpeech and VC and VC.StopSpeakingText then
    local ok, err = pcall(VC.StopSpeakingText)
    dbg("StopSpeakingText", ok, err)
    Voice.stoppedAt = now()
  end
  Voice.ttsActive = false
  setPreview(nil)
end

-- Heard: every narration this character has played, so arriving somewhere again doesn't replay it. Kept per
-- character in LoreForeverDB.heard = { ["Name-Realm"] = { [clip id] = time first heard } }; quest dialogue read
-- aloud is kept as "questtext:<questID>:<detail|progress|complete>".
local function heardStore()
  if type(LoreForeverDB) ~= "table" then return nil end
  if type(LoreForeverDB.heard) ~= "table" then LoreForeverDB.heard = {} end
  local who = (ns.Journey and ns.Journey.CharKey and ns.Journey.CharKey()) or "?"
  local t = LoreForeverDB.heard[who]
  if type(t) ~= "table" then
    t = {}
    LoreForeverDB.heard[who] = t
  end
  return t
end

function Voice.Heard(id)
  local t = id and heardStore()
  return (t and t[id] ~= nil) or false
end

function Voice.MarkHeard(id)
  local t = id and heardStore()
  if t and t[id] == nil then t[id] = (time and time()) or 0 end
end

-- Forget what this character has heard (Options' "Reset heard narrations"). Returns how many were forgotten.
function Voice.ResetHeard()
  local t, n = heardStore(), 0
  for id in pairs(t or {}) do
    t[id] = nil
    n = n + 1
  end
  Voice.autoSession = {}
  return n
end

-- Play an entry's recorded narration: the chosen voice's file, or the next voice's if the game can't play it (e.g.
-- the file is missing from the pack). Returns true if it started.
function Voice.Play(key)
  local paths = Voice.HasAudio(key) and (Voice.active[key] or Voice.questPaths[key])
  if not paths or not _G.PlaySoundFile then return false end
  Voice.Stop()
  for _, path in ipairs(paths) do
    local ok, willPlay, handle = pcall(PlaySoundFile, path, "Dialog")
    if ok and willPlay then
      Voice.handle = handle
      Voice.MarkHeard(key)
      return true
    end
    dbg("can't play", path)
  end
  return false
end

function Voice.IsPlaying()
  if Voice.handle and _G.C_Sound and C_Sound.IsPlaying then
    local ok, playing = pcall(C_Sound.IsPlaying, Voice.handle)
    return ok and playing
  end
  if Voice.pending then return true end
  if Voice.finishedSeen then return Voice.ttsActive end   -- the client reports TTS endings: trust them
  return nil   -- unknown
end

-- The ways to start speech, in order of preference. Blizzard's TextToSpeech_Speak helper queues speech, and after a
-- manual stop that queue can stay blocked, so later answers never play; calling SpeakText directly with immediate
-- playback avoids the queue. The signature changed in 11.x: older clients take a destination (and have
-- Enum.VoiceTtsDestination), newer ones take (voice, text, rate, volume, overlap).
local METHODS = {
  direct = function(id, _, text, rate, volume)
    local VC = _G.C_VoiceChat
    if not (VC and VC.SpeakText and id) then return false, "no SpeakText" end
    local dests = _G.Enum and Enum.VoiceTtsDestination
    if dests then
      return pcall(VC.SpeakText, id, text, dests.LocalPlayback or 1, rate, volume)
    end
    return pcall(VC.SpeakText, id, text, rate, volume, true)
  end,
  helper = function(_, voice, text)
    if not (_G.TextToSpeech_Speak and voice) then return false, "no TextToSpeech_Speak" end
    return pcall(TextToSpeech_Speak, text, voice)
  end,
  legacy = function(id, _, text, rate, volume)
    local VC = _G.C_VoiceChat
    if not (VC and VC.SpeakText and id) then return false, "no SpeakText" end
    return pcall(VC.SpeakText, id, text, 1, rate, volume)
  end,
}
Voice.METHOD_ORDER = { "direct", "helper", "legacy" }

local function speakNow(text, only)
  local id, voice, rate, volume = voiceSettings()
  -- No speech voices at all: the game's text-to-speech uses the system's, and Mac, Linux and Wine setups often have
  -- none. Say so once instead of staying silent (LOR-43); recorded narrations don't need them.
  if not id then
    if not Voice.warnedNoVoices then
      Voice.warnedNoVoices = true
      say(L["Read aloud can't speak: your system has no text-to-speech voices (common on Mac and Linux). Recorded narrations still play."])
    end
    return false
  end
  for _, name in ipairs(only and { only } or Voice.METHOD_ORDER) do
    local ok, err = METHODS[name](id, voice, text, rate, volume)
    dbg("speak via", name, "voice", id, "rate", rate, "volume", volume, "->", ok, err)
    if ok then
      Voice.ttsActive, Voice.spokeAt, Voice.method = true, now(), name
      return true
    end
  end
  return false
end

-- /lore ttstest: say "one", "two", "three" through each method a few seconds apart, so a player can report which
-- they heard (and on which client the helper or the direct call is the one that works).
function Voice.Test()
  local say = function(m) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. m) end
  say("speech test: listen for \"one\", \"two\" and \"three\" and tell us which you heard.")
  for i, name in ipairs(Voice.METHOD_ORDER) do
    C_Timer.After((i - 1) * 4, function()
      Voice.Stop()
      local word = ({ "one", "two", "three" })[i]
      local ok = speakNow("Test " .. word, name)
      say(string.format("  %s = method %s (%s)", word, name, ok and "sent" or "not available"))
    end)
  end
end

-- Text-to-speech stops asynchronously: a new utterance started right after StopSpeakingText gets cancelled along
-- with the old one (which is why only the first Listen used to work). So after a stop, wait a moment first.
local RESTART_DELAY = 0.35
function Voice.Speak(text)
  text = Voice.Plain(text)
  if text == "" or not Voice.Available() then return false end
  local wasSpeaking = Voice.ttsActive
  Voice.Stop()
  if wasSpeaking or (Voice.stoppedAt and now() - Voice.stoppedAt < RESTART_DELAY) then
    local token = {}
    Voice.pending = token
    C_Timer.After(RESTART_DELAY, function()
      if Voice.pending == token then
        Voice.pending = nil
        if not speakNow(text) and ns.UI and ns.UI.StopAll then ns.UI.StopAll() end
      end
    end)
    return true
  end
  return speakNow(text)
end

-- VOICE_CHAT_TTS_PLAYBACK_FINISHED fires for stopped utterances too, sometimes after the next one has started, so
-- only trust it once the current one has had time to begin.
function Voice.OnTTSStarted(...)
  dbg("event STARTED", ...)
  Voice.ttsActive = true
end

function Voice.OnTTSFinished(...)
  dbg("event FINISHED/FAILED", ...)
  Voice.finishedSeen = true
  if Voice.pending or (Voice.spokeAt and now() - Voice.spokeAt < 1) then return false end
  Voice.ttsActive = false
  return true
end

-- The recorded narration if there is one, otherwise text-to-speech of `text`.
function Voice.Narrate(key, text)
  return Voice.Play(key) or Voice.Speak(text)
end

-- Flight narration: when a taxi flight starts, and each time it crosses into a new zone, tell that zone's story.
local narrated = {}
function Voice.OnTaxiCheck()
  if not S().narrateFlights then return end
  local onTaxi = UnitOnTaxi and UnitOnTaxi("player")
  if not onTaxi then
    narrated = {}
    return
  end
  local zone = GetRealZoneText and GetRealZoneText()
  local zk = zone and ns.engine and ns.engine:ZoneKey(zone)
  local key = zk and "zone:" .. zk
  local e = key and ns.DB.entries[key]
  if not e or narrated[zk] then return end
  if ns.UI and ns.UI.speaking and ns.UI.playingId == key then narrated[zk] = true return end
  narrated[zk] = true
  local first = e.sec and e.sec[1]
  local UI = ns.UI
  if UI and UI.PlaylistAddFlight and UI.CanQueue(key) then
    -- Recorded zone stories go through the playlist, so crossing zones quickly queues them one after another
    -- instead of cutting off the one playing.
    UI.PlaylistAddFlight(key)
  elseif UI and UI.ListenTo and UI.EntryTarget then
    -- Read aloud (no recording): only when nothing else is playing, never over it.
    if not UI.IsBusy() then UI.ListenTo(UI.EntryTarget(key)) end
  else
    Voice.Narrate(key, e.n .. ". " .. e.s .. ((first and (first.sp or 0) == 0) and (" " .. first.b) or ""))
  end
end

-- Playing on arrival (Options > Play narrations as you arrive): reaching a zone or a place with a recorded narration
-- plays it, once per character (or once a session with "Skip what you've heard" off). Arrivals settle for a moment
-- first, so a loading screen or hopping back and forth across a zone line plays only where you end up. Nothing starts
-- in combat (it waits for combat to end), on a flight (flight narration has those) or over anything already playing.
local AUTO_SETTLE = 3
Voice.autoSession = {}   -- clip ids played automatically this session

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player")) or false
end

-- Talking to someone: a quest giver's or a gossip window is open. Arriving in a town usually means walking straight
-- up to its quest givers, and the town's story shouldn't talk over them.
local function talking()
  for _, name in ipairs({ "QuestFrame", "GossipFrame" }) do
    local f = _G[name]
    if f and f.IsShown and f:IsShown() then return true end
  end
  return false
end

local function fresh(id)
  if Voice.autoSession[id] then return false end
  return S().skipHeard == false or not Voice.Heard(id)
end

-- What to play where you are: the zone's story the first time you're there, then the place's.
local function arrivalKey()
  local db = ns.DB or {}
  local zone = GetRealZoneText and GetRealZoneText()
  local zk = zone and zone ~= "" and ns.engine and ns.engine:ZoneKey(zone)
  local sub = GetSubZoneText and GetSubZoneText()
  local sk = sub and sub ~= "" and db.index and db.index.name[ns.Engine.lower(sub)]
  if sk and not (db.entries[sk] and db.entries[sk].t == "subzone") then sk = nil end
  for _, key in ipairs({ zk and ("zone:" .. zk) or false, sk or false }) do
    if key and Voice.HasAudio(key) and fresh(key) then return key end
  end
end

local function autoPlay()
  Voice.autoWaiting = nil
  local UI = ns.UI
  if S().autoZone == false or Voice.Current() == "none" or not (UI and UI.frame) then return end
  if inCombat() or talking() then
    Voice.autoWaiting = true
    return
  end
  if (UnitOnTaxi and UnitOnTaxi("player")) or UI.IsBusy() then return end
  local key = arrivalKey()
  local target = key and UI.EntryTarget(key)
  if not target then return end
  Voice.autoSession[key] = true
  if UI.frame:IsShown() then
    -- Panel open: the story goes in the chat too, as when you press play yourself.
    return UI.PlayEntry(key, string.format(L["Tell me the story of %s"], target.label))
  end
  UI.ListenTo(target)
  if not (UI.speaking and UI.playingId == key) then return end
  local line = string.format(L["now playing: %s. %s"], target.label, ns.Hooks.Link(L["Read along"], "entry", key))
    .. " " .. ns.Hooks.Link(L["Stop"], "listen", key)
  if not S().autoZoneTold then
    S().autoZoneTold = true
    line = line .. " " .. L["(Narrations play as you arrive; Options > Play narrations as you arrive turns this off.)"]
  end
  say(line)
end

-- Called on every zone or subzone change, and at login.
function Voice.OnArrive()
  if S().autoZone == false then return end
  local token = {}
  Voice.autoToken = token
  C_Timer.After(AUTO_SETTLE, function()
    if Voice.autoToken == token then autoPlay() end
  end)
end

-- Combat ended, or you stopped talking to someone: an arrival that came meanwhile plays now (if you're still there
-- and nothing else plays). It settles first, so walking from one quest giver to the next doesn't start it.
function Voice.OnCombatOver()
  if Voice.autoWaiting then Voice.OnArrive() end
end
Voice.OnTalkOver = Voice.OnCombatOver

-- Quest dialogue (Options > Narrate quest dialogue): when a quest giver's window opens, play the quest's recorded
-- narration if it has one (on the quest's first page), otherwise read the page aloud with the game's voice when Read
-- aloud is on. Closing the window or opening another quest stops it; a page this character has heard isn't read again.
local QUEST_PREFIX = "questtext:"

local function isQuestText(id) return type(id) == "string" and id:sub(1, #QUEST_PREFIX) == QUEST_PREFIX end

local function questPage(kind)
  local parts = {}
  local function add(fn)
    local f = _G[fn]
    local ok, v = false, nil
    if f then ok, v = pcall(f) end
    if ok and type(v) == "string" and v:find("%S") then parts[#parts + 1] = v end
  end
  if kind == "detail" then
    add("GetTitleText")
    add("GetQuestText")
    add("GetObjectiveText")
  elseif kind == "progress" then
    add("GetProgressText")
  else
    add("GetRewardText")
  end
  return table.concat(parts, " ")
end

-- A voice's gender, for matching quest givers: ## X-LoreForever-Gender (male or female) in its .toc, else read from
-- our own packs' names (LoreForever_Voice_Female..., the default voice is the male narrator). nil if unknown.
function Voice.Gender(name)
  local rec = ns.Packs.Get(name)
  local g = rec and rec.gender and rec.gender:lower()
  if g == "male" or g == "female" then return g end
  if name:find("_Female", 1, true) then return "female" end
  if isDefault(name) then return "male" end
end

-- The fingerprints of a quest text as the add-on's data has them (lore.quest_dialogue.fingerprint): the player's own
-- name, class and race taken out (the game puts them where the text has <name>, <class>, <race>; "<race>s" shows as
-- "Humans", so a plural s stays), then the letters and digits only, lower-cased, hashed with djb2 mod 2^32. Spacing,
-- punctuation and accents never matter. A text can also name a class or race outright ("He's human"), so there's one
-- fingerprint with and one without taking each out; the first takes out all three.
local function escapePattern(s) return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
local function playerWord(fn)
  local f = _G[fn]
  local ok, word = false, nil
  if f then ok, word = pcall(f, "player") end
  return ok and type(word) == "string" and word ~= "" and word:lower() or nil
end
local function djb2(s)
  s = s:gsub("[^%w]", "")
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return string.format("%08x", h)
end
function Voice.QuestFingerprints(text)
  local function without(s, word, loose)
    if not word then return s end
    -- loose: the name with a suffix glued on, as a dwarf says it ("<name>ama" shows as "Testerama").
    return (s:gsub("%f[%w]" .. escapePattern(word) .. (loose and "" or "(s?)%f[%W]"), loose and "" or "%1"))
  end
  local lower, name = string.lower(text or ""), playerWord("UnitName")
  local class, race = playerWord("UnitClass"), playerWord("UnitRace")
  local out, seen = {}, {}
  for _, base in ipairs({ without(lower, name), without(lower, name, true) }) do
    for _, s in ipairs({ without(without(base, class), race), without(base, race), without(base, class), base }) do
      local fp = djb2(s)
      if not seen[fp] then seen[fp], out[#out + 1] = true, fp end
    end
  end
  return out
end
function Voice.QuestFingerprint(text) return Voice.QuestFingerprints(text)[1] end

local QUEST_PART = { detail = 2, progress = 3, complete = 4 }
local QUEST_TEXT = { detail = "GetQuestText", progress = "GetProgressText", complete = "GetRewardText" }

-- The recorded quest dialogue for the open quest window, if a voice has one and its text is exactly what's on screen
-- (ns.DB.questVoice[questID] = { quest the clip is named after, fingerprints of its quest text, progress text and
-- completion text }); nil otherwise, so a quest Forever changed is read aloud instead. With "Match the quest giver's
-- voice" on, a voice of the quest giver's gender (UnitSex("npc")) goes first. Fills Voice.questPaths[id] for
-- Voice.Play.
function Voice.QuestClip(qid, kind)
  local rec = qid and QUEST_PART[kind] and ns.DB and ns.DB.questVoice and ns.DB.questVoice[qid]
  local fps = rec and rec[QUEST_PART[kind]]
  if not fps or fps == "" then return nil end
  if not Voice.ready then Voice.Refresh() end
  local id = "quest:" .. rec[1] .. "#" .. kind
  local list = Voice.questRanked and Voice.questRanked[id]
  if not list then return nil end
  local f = _G[QUEST_TEXT[kind]]
  local ok, text = false, nil
  if f then ok, text = pcall(f) end
  if not ok or type(text) ~= "string" or not text:find("%S") then return nil end
  local match = false
  for _, fp in ipairs(Voice.QuestFingerprints(text)) do
    if (" " .. fps .. " "):find(" " .. fp .. " ", 1, true) then match = true break end
  end
  if not match then return nil end
  local order = list
  if S().voiceMatchGender ~= false and #list > 1 then
    local ok2, sex = false, nil
    if _G.UnitSex then ok2, sex = pcall(UnitSex, "npc") end
    local want = ok2 and (sex == 2 and "male" or sex == 3 and "female") or nil
    if want then
      local yes, no = {}, {}
      for _, v in ipairs(list) do table.insert(Voice.Gender(v[1]) == want and yes or no, v) end
      for _, v in ipairs(no) do yes[#yes + 1] = v end
      order = yes
    end
  end
  local paths = {}
  for _, v in ipairs(order) do paths[#paths + 1] = v[2] end
  -- Kept apart from Voice.active / servedBy, which list and count the lore narrations (Listen tab, Status).
  Voice.questPaths[id], Voice.questServed[id] = paths, order[1][1]
  return id
end

-- kind: "detail", "progress" or "complete"; recorded: the quest's lore entry, if it has one. The quest giver's own
-- words play when a voice recorded them (Voice.QuestClip); else, on the first page, the quest's lore narration.
function Voice.OnQuestFrame(kind, recorded)
  local UI = ns.UI
  if S().autoQuest == false or not (UI and UI.frame) then return end
  local qid = GetQuestID and GetQuestID()
  if not qid or qid == 0 then return end
  local id = QUEST_PREFIX .. qid .. ":" .. kind
  local ours = UI.speaking and isQuestText(UI.playingId)
  if UI.IsBusy() and not ours then return end   -- never over something you started
  if UI.playingId == id then return end
  local key = Voice.Current() ~= "none" and Voice.QuestClip(qid, kind) or nil
  key = key or (kind == "detail" and recorded and Voice.Current() ~= "none" and Voice.HasAudio(recorded)
    and recorded or nil)
  local text = questPage(kind)
  if not fresh(id) or not (key or (text ~= "" and Voice.Available())) then
    if ours then UI.StopAll() end   -- the last quest's page stops all the same
    return
  end
  Voice.autoSession[id] = true
  UI.ListenTo({ id = id, key = key or id, label = (GetTitleText and GetTitleText()) or L["Quest"], text = text })
  if UI.speaking and UI.playingId == id then Voice.MarkHeard(id) end
end

-- The quest window closed: stop its page.
function Voice.OnQuestClosed()
  local UI = ns.UI
  if UI and UI.speaking and isQuestText(UI.playingId) then UI.StopAll() end
end

-- Books, letters and plaques (Options > Read books aloud, LOR-49): opening one reads its page with the game's voice
-- when Read aloud is on, turning the page reads the next, closing it stops. Like quest dialogue, a page this
-- character has heard isn't read again by itself, and nothing cuts off something you started. The Read aloud button
-- on the book reads the page on demand (Voice.ReadBookPage(true)). Books have no recordings yet: if one ever has a
-- clip under its page id, that plays instead.
local BOOK_PREFIX = "booktext:"

local function isBookText(id) return type(id) == "string" and id:sub(1, #BOOK_PREFIX) == BOOK_PREFIX end
Voice.IsBookText = isBookText

local function bookPage()
  local function get(fn)
    local f = _G[fn]
    if not f then return nil end
    local ok, v = pcall(f)
    return ok and v or nil
  end
  local title, text, page = get("ItemTextGetItem"), get("ItemTextGetText"), get("ItemTextGetPage")
  if type(text) ~= "string" then return nil end
  -- Some books are HTML: read the words, not the markup.
  text = text:gsub("<[^>]+>", " "):gsub("&nbsp;", " "):gsub("&amp;", "&"):gsub("%s+", " "):match("^%s*(.-)%s*$")
  if not text:find("%S") then return nil end
  title = type(title) == "string" and title ~= "" and title or L["Book"]
  local id = BOOK_PREFIX .. ns.Engine.lower(title) .. "#" .. tostring(tonumber(page) or 1)
  return id, title, text
end

-- A page is showing. byHand: the book's Read aloud button (plays even if heard, stops it if it's this page).
function Voice.ReadBookPage(byHand)
  local UI = ns.UI
  if not (UI and UI.frame) then return end
  if not byHand and S().readBooks == false then return end
  local id, title, text = bookPage()
  if not id then return end
  if byHand and UI.speaking and UI.playingId == id then return UI.StopAll() end
  local ours = UI.speaking and isBookText(UI.playingId)
  if not byHand then
    if UI.IsBusy() and not ours then return end   -- never over something you started
    if UI.playingId == id then return end
  end
  local key = Voice.HasAudio(id) and id or nil
  if not (key or Voice.Available()) or (not byHand and not fresh(id)) then
    if ours then UI.StopAll() end   -- the last page stops all the same
    return
  end
  Voice.autoSession[id] = true
  UI.ListenTo({ id = id, key = id, label = title, text = text })
  if UI.speaking and UI.playingId == id then Voice.MarkHeard(id) end
end

-- The book closed: stop its page.
function Voice.OnBookClosed()
  local UI = ns.UI
  if UI and UI.speaking and isBookText(UI.playingId) then UI.StopAll() end
end

-- Whether a loaded add-on's folder name, in lower case, passes match.
local function addOnLoaded(match)
  local C = _G.C_AddOns
  local count = (C and C.GetNumAddOns) or _G.GetNumAddOns
  local info = (C and C.GetAddOnInfo) or _G.GetAddOnInfo
  local loaded = (C and C.IsAddOnLoaded) or _G.IsAddOnLoaded
  if not (count and info and loaded) then return false end
  local okN, n = pcall(count)
  for i = 1, (okN and n) or 0 do
    local ok, name = pcall(info, i)
    if ok and type(name) == "string" and match(name:lower()) then
      local okL, isLoaded = pcall(loaded, name)
      if okL and isLoaded then return true end
    end
  end
  return false
end

-- Players who run the Spoken add-ons (zones, quests and books read aloud) would hear both. The first time Lore
-- Forever finds one loaded, it leaves arrivals and quest dialogue to Spoken and says how to turn them back on; after
-- that the player's choice in Options stands (LOR-138).
function Voice.CheckSpoken()
  local s = S()
  if s.spokenChecked and s.spokenBooks then return end
  if not addOnLoaded(function(name) return name:find("^spoken") end) then return end
  -- Books came later (LOR-49): players already past the first check have them left to Spoken on their own.
  local booksOff = not s.spokenBooks and s.readBooks ~= false
  s.spokenBooks = true
  if booksOff then s.readBooks = false end
  if s.spokenChecked then
    if booksOff then say(L["Spoken is running, so Lore Forever won't read books aloud by itself. Options > Read books aloud turns that back on."]) end
    return
  end
  s.spokenChecked = true
  if s.autoZone == false and s.autoQuest == false then return end
  s.autoZone, s.autoQuest = false, false
  say(L["Spoken is running, so narrations won't play by themselves as you arrive or talk to a quest giver. Type /lore autoplay (or use Options) to turn that back on."])
end

-- Other add-ons that voice quest dialogue (LOR-182), by the core folder their Forever builds install (their voice packs
-- depend on it). folders: lower case, any one loaded counts; books: it reads books aloud too. None plays on arrival.
local QUEST_VOICES = {
  { id = "forevervo", title = "Forever Voiceover", folders = { forevervo = true } },
  { id = "chronicle", title = "Chronicle", folders = { foreverchronicle = true }, books = true },
  { id = "speakstone", title = "SpeakStone Forever", folders = { speakstone_forever_main = true }, books = true },
  -- VoiceOver Forever and the original VoiceOver share this folder.
  { id = "voiceover", title = "VoiceOver", folders = { ai_voiceover = true } },
  { id = "voiceovercontinued", title = "VoiceOver Continued",
    folders = { voiceover_continued = true, ai_voiceover_continued = true } },
  { id = "chatty", title = "Chatty Little NPC", folders = { chattylittlenpc = true }, books = true },
}

-- Players who run one of those would hear a quest page twice. The first time Lore Forever finds one loaded, it leaves
-- quest dialogue (and books, if that add-on reads them) to it and says how to turn that back on; after that the
-- player's choice in Options stands. Each add-on is checked once, so one installed later gets the same.
function Voice.CheckQuestVoices()
  local s = S()
  local checked = type(s.questVoicesChecked) == "table" and s.questVoicesChecked or {}
  for _, v in ipairs(QUEST_VOICES) do
    if not checked[v.id] and addOnLoaded(function(name) return v.folders[name] end) then
      checked[v.id] = true
      s.questVoicesChecked = checked
      local quests, books = s.autoQuest ~= false, v.books and s.readBooks ~= false
      if quests then s.autoQuest = false end
      if books then s.readBooks = false end
      if quests and books then
        say(string.format(L["%s is running, so quest dialogue and books won't play by themselves. Type /lore autoplay (or use Options) to turn quest dialogue back on, and Options > Read books aloud for books."], v.title))
      elseif quests then
        say(string.format(L["%s is running, so quest dialogue won't play by itself when you talk to a quest giver. Type /lore autoplay (or use Options) to turn that back on."], v.title))
      elseif books then
        say(string.format(L["%s is running, so Lore Forever won't read books aloud by itself. Options > Read books aloud turns that back on."], v.title))
      end
    end
  end
end

-- /lore autoplay: both automatic narrations on if either is off (one may have been left to another add-on), else both
-- off. Returns the new state.
function Voice.ToggleAutoplay()
  local s = S()
  local on = s.autoZone == false or s.autoQuest == false
  s.autoZone, s.autoQuest = on, on
  if not on then
    Voice.autoToken = nil
    Voice.OnQuestClosed()
  end
  return on
end
