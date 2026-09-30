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

-- Recorded narration comes from voice packs (see Packs.lua): the voice the player picked, then the default pack for
-- the reading language, then nothing (the caller falls back to text-to-speech). A pack's clip is used only while it
-- was recorded from the current text (its hash matches ns.DB.clipHash), so a recording never contradicts the page.
local DEFAULT_PACK = "LoreForever_Voice_Default"
local LANGUAGES = { enUS = "English", enGB = "English", deDE = "Deutsch", frFR = "Français", esES = "Español",
  esMX = "Español (Latinoamérica)", ptBR = "Português", itIT = "Italiano", ruRU = "Русский", koKR = "한국어",
  zhCN = "简体中文", zhTW = "繁體中文" }

local function readingLocale() return ns.readingLocale or "enUS" end
-- Same language, whatever the region: enGB recordings suit English text (the clip hashes still decide per clip).
local function sameLanguage(a, b) return (a or "enUS"):sub(1, 2) == (b or "enUS"):sub(1, 2) end
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end

Voice.active, Voice.chain, Voice.stats, Voice.total = {}, {}, {}, 0

-- Where a pack keeps a clip: zone:stormwind -> Audio\zone_stormwind.mp3, zone:stormwind#faq3 -> ...__faq3.mp3.
function Voice.ClipPath(pack, id, ext)
  local base, n = id:match("^(.-)#faq(%d+)$")
  local stem = ((base or id):gsub("[^%w%-_]", "_"))
  return "Interface\\AddOns\\" .. pack .. "\\Audio\\" .. stem .. (n and ("__faq" .. n) or "") .. "." .. (ext or "mp3")
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

-- Current and stale clip counts for a loaded pack.
function Voice.Count(name)
  local data, hashes, have, stale = ns.Packs.data[name], (ns.DB and ns.DB.clipHash) or {}, 0, 0
  for id, h in pairs(data and data.clips or {}) do
    if hashes[id] == h then have = have + 1 elseif hashes[id] then stale = stale + 1 end
  end
  return have, stale
end

-- Rebuild Voice.active (clip id -> the paths to try, in order) from the chosen voice.
function Voice.Refresh()
  local choice, chain = S().voicePack or "auto", {}
  Voice.deferred = nil
  if choice ~= "none" then
    if choice ~= "auto" and ensure(choice) then chain[#chain + 1] = choice end
    local def = Voice.DefaultPack()
    if def and def ~= chain[1] and ensure(def) then chain[#chain + 1] = def end
  end
  local active, stats, total = {}, {}, 0
  for _, name in ipairs(chain) do stats[name] = { have = 0, stale = 0 } end
  for id, hash in pairs((ns.DB and ns.DB.clipHash) or {}) do
    total = total + 1
    for _, name in ipairs(chain) do
      local data = ns.Packs.data[name]
      local h = data.clips[id]
      if h == hash then
        active[id] = active[id] or {}
        table.insert(active[id], Voice.ClipPath(name, id, data.ext))
        stats[name].have = stats[name].have + 1
      elseif h then
        stats[name].stale = stats[name].stale + 1
      end
    end
  end
  Voice.active, Voice.chain, Voice.stats, Voice.total, Voice.ready = active, chain, stats, total, true
end

-- Say once if the saved voice can't be used (the saved choice is kept, so reinstalling it brings it back).
local function noticeMissing()
  local choice = S().voicePack
  if not choice or choice == "auto" or choice == "none" or Voice.chain[1] == choice then return end
  local rec = ns.Packs.Get(choice)
  local why, code = Voice.Unusable(choice)
  local title = rec and rec.title or choice
  local fallback = (Voice.chain[1] and 1) or (Voice.Available() and 2) or 3   -- the default voice, Read aloud, nothing
  if code == "MISSING" then
    say(string.format(({ L["voice pack %s isn't installed; using the default voice."],
      L["voice pack %s isn't installed; using Read aloud."],
      L["voice pack %s isn't installed; using no narration."] })[fallback], title))
  elseif why then
    say(string.format(({ L["voice pack %s can't be used: %s; using the default voice."],
      L["voice pack %s can't be used: %s; using Read aloud."],
      L["voice pack %s can't be used: %s; using no narration."] })[fallback], title, why))
  else
    say(string.format(({ L["voice pack %s didn't load; using the default voice."],
      L["voice pack %s didn't load; using Read aloud."],
      L["voice pack %s didn't load; using no narration."] })[fallback], title))
  end
end

-- At login: find the installed packs and load the chosen voice.
function Voice.Init()
  if not next(ns.Packs.registry) then ns.Packs.Scan() end
  Voice.Refresh()
  if not Voice.deferred then noticeMissing() end
end

-- Combat ended: load the packs that had to wait, then relabel the panel.
function Voice.OnCombatEnded()
  if not Voice.deferred then return end
  Voice.Refresh()
  noticeMissing()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
end

-- A recorded narration exists for this entry with the current voice.
function Voice.HasAudio(key)
  if not Voice.ready then Voice.Refresh() end
  return key ~= nil and Voice.active[key] ~= nil
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
    if not isDefault(rec.name) then
      ensure(rec.name)
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

-- The line under the picker: whose voice this is, how much it covers, and what fills the gaps.
function Voice.Status()
  local choice = S().voicePack or "auto"
  if choice == "none" then
    if S().readAloud == false then return L["Recorded narrations are off, and so is Read aloud."] end
    return L["Recorded narrations are off. Read aloud uses the game's voice (Options > Accessibility > Text to Speech)."]
  end
  local def, lines = Voice.DefaultPack(), {}
  local chosen = choice ~= "auto" and choice or nil
  if chosen and Voice.chain[1] ~= chosen then
    local rec = ns.Packs.Get(chosen)
    lines[#lines + 1] = string.format(L["%s: %s. Using the default voice."], rec and rec.title or chosen,
      Voice.Unusable(chosen) or L["didn't load"])
    chosen = nil
  end
  local name = chosen or (def and Voice.stats[def] and def)
  if not name then
    lines[#lines + 1] = L["No recorded narrations installed. Read aloud uses the game's voice."]
    return table.concat(lines, " ")
  end
  local rec, st = ns.Packs.Get(name), Voice.stats[name]
  local restDefault = (chosen and Voice.stats[def]) and true or false   -- else the rest use Read aloud
  local count
  if st.have >= Voice.total then
    count = L["%d of %d narrations."]
  elseif restDefault then
    count = L["%d of %d narrations; the rest use the default voice."]
  else
    count = L["%d of %d narrations; the rest use Read aloud."]
  end
  local s = (rec.credit and (rec.credit:gsub("%.$", "") .. ". ") or "") .. string.format(count, st.have, Voice.total)
  if st.stale > 0 then
    local stale
    if st.stale == 1 then
      stale = restDefault and L["%d recording is older than the current lore text and uses the default voice."]
        or L["%d recording is older than the current lore text and uses Read aloud."]
    else
      stale = restDefault and L["%d recordings are older than the current lore text and use the default voice."]
        or L["%d recordings are older than the current lore text and use Read aloud."]
    end
    s = s .. " " .. string.format(stale, st.stale)
  end
  lines[#lines + 1] = s
  return table.concat(lines, " ")
end

-- Switch voice ("auto", "none" or a pack's add-on name). Returns true, or false and why not.
function Voice.SetPack(value)
  if value ~= "auto" and value ~= "none" then
    if InCombatLockdown and InCombatLockdown() then return false, L["Can't switch voice during combat"] end
    ensure(value)
    local why = Voice.Unusable(value) or (not ns.Packs.IsLoaded(value) and L["Didn't load"]) or nil
    if why then return false, why end
  end
  S().voicePack = value
  Voice.Refresh()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
  return true
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
end

-- Play an entry's recorded narration: the chosen voice's file, or the next voice's if the game can't play it (e.g.
-- the file is missing from the pack). Returns true if it started.
function Voice.Play(key)
  local paths = Voice.HasAudio(key) and Voice.active[key]
  if not paths or not _G.PlaySoundFile then return false end
  Voice.Stop()
  for _, path in ipairs(paths) do
    local ok, willPlay, handle = pcall(PlaySoundFile, path, "Dialog")
    if ok and willPlay then
      Voice.handle = handle
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
  -- Through the panel's player, so the Now playing bar and Stop buttons show it too.
  if ns.UI and ns.UI.ListenTo and ns.UI.EntryTarget then
    ns.UI.ListenTo(ns.UI.EntryTarget(key))
  else
    Voice.Narrate(key, e.n .. ". " .. e.s .. ((first and (first.sp or 0) == 0) and (" " .. first.b) or ""))
  end
end
