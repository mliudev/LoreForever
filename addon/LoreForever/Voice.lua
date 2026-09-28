-- Read lore aloud: narrated MP3 intros for the most-visited places, the game's text-to-speech for everything else,
-- and optional narration of each zone while on a flight.
-- The TTS API has changed shape across client versions, so every call is tried defensively.

local _, ns = ...
local Voice = {}
ns.Voice = Voice

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

-- A recorded narration exists for this entry.
function Voice.HasAudio(key)
  return key ~= nil and ns.DB.audio ~= nil and ns.DB.audio[key] ~= nil
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

-- Play an entry's recorded narration. Returns true if it started.
function Voice.Play(key)
  local path = ns.DB.audio and ns.DB.audio[key]
  if not path or not _G.PlaySoundFile then return false end
  Voice.Stop()
  local ok, willPlay, handle = pcall(PlaySoundFile, path, "Dialog")
  if ok and willPlay then
    Voice.handle = handle
    return true
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
