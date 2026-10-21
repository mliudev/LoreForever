// Pinned spots (LOR-664, one of Mike's five second-brain picks, 10/18): "pin this spot, the elite in this cave hits
// hard", found again later ("where was that cave I pinned?", "what pins do I have?"), renamed and taken out. Kept in her
// notebook (lib/willo-notebook.js), on the character's page under "## Pins", one line each:
//
//   - Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18
//
// so the Notebook tab and the "What Willo keeps" page show them, and they're edited, erased and undone like any line,
// and deleted with the account. The place and the day are the game's, never the answer model's: Willo's app sends
// "spot now:" in PLAYER CONTEXT only when it knows where they stand right now (a question from the add-on's Ask box,
// which also carries the map spot, or with Live game info on; companion/lore_companion/answer.py), and without it she
// pins nothing and says how she could. The model names the pin and says what to remember; this file writes the line.

import { placeKey } from "./willo-notebook.js";
import { battleground } from "./battlegrounds.js";

export const PINS_HEADING = "Pins";
// Her one pin tool, a notebook tool by its name (lib/willo-notebook.js isNotebookTool: done when called, with the
// notebook's rules). Renaming and taking out a pin are the notebook's own notebook_update and notebook_remove, with their
// guards (a line the player didn't name is never changed; a name two lines share asks which); pinUpdate keeps a renamed
// pin's place and day the game's.
export const PIN_TOOL = "notebook_pin";
const NAME_CHARS = 60, NOTE_CHARS = 120;
const SEP = " · ";

// The question asks to pin where they stand ("pin this spot", "mark this place", "remember this cave", "drop a pin"),
// to rename or take out a pin, or about their pins. Kept in step with companion/lore_companion/recall.py PINS, which
// leaves these questions to the notebook.
// "Mark this as a spot that's cool to look out from" too (Mike, 10/19: Willo said "I have marked the Gates of Ironforge in
// your notes" and nothing was written).
const ADD = /\b(?:pin|mark|save|bookmark|remember)\s+(?:this|that|our|my|the)\s+(?:\w+\s+)?(?:spot|place|location|cave|camp|den|cove|room|corner|ledge|ridge)\b|\bpin\s+(?:it|this|that|here|where)\b|\bdrop\s+a\s+pin\b|\b(?:pin|mark)\s+(?:it\s+)?here\b|\b(?:pin|mark|save|bookmark|remember)\s+(?:this|that|it|here)\s+(?:place\s+|spot\s+)?as\s+(?:a|an|my|the|our)?\s*(?:[\w'-]+\s+){0,3}(?:spot|place|location|lookout|view|vista|landmark|pin)\b/i;
// Asking about a pin they made isn't making one: "Where did I pin the fishing spot?" (QA 10/19: it was read as "pin the
// fishing spot", and she repeated why she couldn't pin).
const RECALL = /\b(?:where|when|why|what|which|did|have|had)\s+(?:did\s+|have\s+|had\s+)?(?:i|we)\s+(?:already\s+)?(?:pin|mark|save|bookmark)(?:ned|ed)?\b/i;
const MANAGE = /\b(?:rename|call|name|retitle|relabel)\b[^.?!]{0,60}\bpin\b|\b(?:remove|delete|drop(?!\s+a\s+pin)|clear|erase|forget|scrap|bin)\b[^.?!]{0,60}\bpins?\b|\bunpin\b/i;
const READ = /\bpins?\b|\bpinned\b|\bmy\s+(?:marked\s+|saved\s+)?spots\b/i;
// "What pins do I have?", "list my pins", "how many pins?": the list, built here from this character's pins and their
// pins for all characters, never from the talk before (the blind check, 10/18: Brynn heard Húrin's pin, pinned earlier
// in the same chat).
const LIST = /\b(?:what|which|list|show|read|tell\s+me)\b[^.?!]{0,30}\b(?:pins|pinned\s+spots|spots\s+(?:i|we)\s+pinned)\b|\bhow\s+many\s+pins\b|\b(?:what|which)\s+(?:have\s+)?(?:i|we)\s+pinned\b|^\s*(?:my\s+)?pins\s*\??\s*$/i;
// "Clear all my pins": she takes them off one at a time; the Notebook tab clears them all.
const CLEAR_ALL = /\b(?:clear|remove|delete|erase|wipe|drop|scrap|unpin)\b[^.?!]{0,20}\b(?:all|every|each)\b[^.?!]{0,20}\bpins?\b|\b(?:clear|wipe)\s+(?:out\s+)?(?:my|the)\s+pins\b/i;

// A pin by a place's name, asked from anywhere (LOR-672: Willo for iPhone has no game position): "pin Fargodeep Mine
// as the kobold den", "Can you pin Westfall?", "bookmark Stormwind City". named: what follows "pin" (a place, checked
// against this age's places by placeNamed); as: the name they gave it. Only a question that starts with the ask (the
// blind check, 10/18: "What's the pin on the map?" and "who would pin the blame on Arthas?" are questions, not pins).
// Never "pin this", "pin it", "pin here": those are where they stand (ADD).
const NAMED = /^\s*(?:(?:hey\s+)?willow?[,!]?\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+)?(?:pin|bookmark)\s+(?!(?:this|that|it|here|there|where|down|a|an|one|my\s+spot|the\s+spot)\b)([^?.!]{3,80}?)(?:\s+as\s+([^?.!]{1,60}?))?\s*(?:for\s+me|please)?\s*[.!?]*\s*$/i;
// "Pin where I last was", "pin my last spot", "pin where I logged out": the place their last save holds (lastPlace).
const LAST = /\bpin\b[^.?!]{0,20}\b(?:where\s+(?:i|we)\s+(?:last\s+(?:was|were|stood)|logged\s+(?:out|off)|left\s+off|was\s+last)|(?:my|our)\s+last\s+(?:spot|place|location))\b(?:\s+as\s+([^?.!]{1,60}?))?\s*(?:for\s+me|please)?\s*[.!?]*\s*$/i;
const LAST_ANY = /\bpin\b[^.?!]{0,20}\b(?:where\s+(?:i|we)\s+(?:last\s+(?:was|were|stood)|logged\s+(?:out|off)|left\s+off|was\s+last)|(?:my|our)\s+last\s+(?:spot|place|location))\b/i;

// {add, manage, read, list, clearAll, named, as, last}: offered notebook_pin (add) or the notebook's own tools
// (manage), the whole notebook read, numbered (any of them); the list and clearing all are answered here.
export function pinIntent(question) {
  const q = String(question || "").replace(/’/g, "'");
  const clearAll = CLEAR_ALL.test(q);
  const manage = !clearAll && MANAGE.test(q);
  const last = !manage && !clearAll && LAST_ANY.test(q);
  const here = !manage && !clearAll && !last && ADD.test(q) && !RECALL.test(q);
  const name = !manage && !clearAll && !last && !here ? NAMED.exec(q) : null;
  const add = here || last || Boolean(name);
  const list = !add && !manage && !clearAll && LIST.test(q);
  const as = (name ? name[2] : last ? LAST.exec(q)?.[1] : "") || "";
  return { add, manage, read: add || manage || clearAll || READ.test(q), list, clearAll,
    ...(name ? { named: name[1].trim() } : {}), ...(last ? { last } : {}), ...(name || last ? { as: as.trim() } : {}) };
}

// ---- Pins by a place's name, and from a phone (LOR-672) ----

// This age's places by name, each with its zone (what a pin by name writes): the lore library's zones, dungeons and
// places (public/lore/data/index.json, a subzone with the zone it's in) and the towns with theirs
// (lib/forever-services.js). {placeKey -> "Fargodeep Mine, Elwynn Forest" | "Westfall"}. Zone and place names only:
// never map numbers, which a phone doesn't have.
export function pinPlacesOf(index, towns = {}) {
  const out = new Map();
  const zones = new Map((Array.isArray(index?.zones) ? index.zones : []).map(z => [z?.key, z?.name]));
  const put = (name, zone) => {
    const key = placeKey(name);
    if (!key || out.has(key)) return;
    out.set(key, zone && placeKey(zone) !== key ? `${name}, ${zone}` : name);
  };
  for (const p of Array.isArray(index?.pages) ? index.pages : []) {
    if (["zone", "subzone", "dungeon"].includes(p?.k) && typeof p.n === "string") put(p.n, p.k === "subzone" ? zones.get(p.z) : "");
  }
  for (const [town, [zone] = []] of Object.entries(towns || {})) put(town, typeof zone === "string" ? zone : "");
  for (const zone of zones.values()) if (typeof zone === "string") put(zone, "");
  return out;
}
const pinPlacesCache = new WeakMap();
export async function pinPlaces(env) {
  const key = env.ASSETS || env;
  if (pinPlacesCache.has(key)) return pinPlacesCache.get(key);
  let index = null, towns = {};
  try { ({ TOWNS: towns } = await import("./forever-services.js")); } catch (e) { console.warn(`pin places: towns: ${e?.message || e}`); }
  try {
    // A missing asset comes back as the home page with a 200: JSON or nothing.
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request("https://assets.local/lore/data/index.json")) : null;
    index = res?.ok ? await res.json() : null;
  } catch (e) { console.warn(`pin places: lore: ${e?.message || e}`); }
  const places = pinPlacesOf(index, towns);
  if (places.size) pinPlacesCache.set(key, places);
  return places;
}

// The place a pin by name means: the place itself ("Fargodeep Mine"), else the longest place named in what they said
// ("Fargodeep Mine in Elwynn", "the mine at Goldshire"). "Fargodeep Mine, Elwynn Forest", or null for none this age has.
export function placeNamed(said, places) {
  const key = placeKey(said);
  if (!key || !places?.size) return null;
  if (places.has(key)) return places.get(key);
  let best = null;
  for (const [k, where] of places) {
    if (k.length >= 4 && ` ${key} `.includes(` ${k} `) && (!best || k.length > best[0].length)) best = [k, where];
  }
  return best ? best[1] : null;
}

// The player's day ("October 18") on their own clock: minutes from UTC as Willo's app sends them (notebook.offset),
// else UTC.
export function dayOn(now, offset) {
  const at = new Date(now.getTime() + (Number.isInteger(offset) ? offset : 0) * 60e3);
  return `${at.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${at.getUTCDate()}`;
}

// Where their last save left them: the newest moment of the journey Willo's app synced (lib/journey.js readJourney)
// that names a place outside a battleground (LOR-685), as the profile's "Last seen" does. {place, x: null, y: null,
// day}, or null with none.
export function lastPlace(journey) {
  const moments = Array.isArray(journey?.moments) ? journey.moments : [];
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if (typeof m?.z !== "string" || !m.z || battleground(m.z)) continue;
    const place = m.s && placeKey(m.s) !== placeKey(m.z) ? `${m.s}, ${m.z}` : m.z;
    const tz = Number.isInteger(m.tz) ? m.tz : Number.isInteger(journey.tz) ? journey.tz : 0;
    return { place, x: null, y: null, day: dayOn(new Date(m.t * 1000), tz) };
  }
  return null;
}

// What a pin from a question without the game's spot is, when it can be one: a place they named that this age has,
// or where their last save left them. {spot} to pin, or {say} when it can't be pinned (a name no place has), or null.
export function spotWithout(intent, places, journey, now, offset) {
  if (intent?.named) {
    const where = placeNamed(intent.named, places);
    if (!where) return { say: NO_PLACE_LINE(intent.named) };
    return { spot: { place: where, x: null, y: null, day: dayOn(now, offset), named: true, ...(intent.as ? { as: intent.as } : {}) } };
  }
  if (intent?.last) {
    const spot = lastPlace(journey);
    return spot ? { spot: { ...spot, saved: true, ...(intent.as ? { as: intent.as } : {}) } } : { say: NO_SAVED_PLACE_LINE };
  }
  return null;
}
export const NO_PLACE_LINE = name => `I don't know a place called ${String(name).replace(/^the\s+/i, "")} in the world as ` +
  "it is now, so I haven't pinned anything. Tell me its name as the map shows it: a zone, a town, a mine or a camp.";
export const NO_SAVED_PLACE_LINE = "I don't have where your last save left you yet, so I haven't pinned anything. Name " +
  "the place and I'll pin it: \"pin Fargodeep Mine as the kobold den\".";
// Asked to pin where they stand from Willo for iPhone, which never knows it (P1): nothing is pinned, and her line says
// so and how to pin from the phone; with where their last save left them, that too.
export function phoneNoSpotLine(journey) {
  const last = lastPlace(journey);
  return "I can't see where you're standing from your phone, so I haven't pinned anything. Name the place and I'll " +
    "pin it: \"pin Fargodeep Mine as the kobold den\"." +
    (last ? ` Or say "pin where I last was" for ${where(last.place)}, as of your last save.` : "");
}

// Where they stand, as Willo's app says it ("spot now: Fargodeep Mine, Elwynn Forest (map 41, 65), October 18"):
// {place, x, y, day}, or null when it doesn't say (it doesn't know where they stand right now).
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const SPOT = new RegExp(String.raw`^spot now: ([^\n()]{2,120}?)(?: \(map (\d{1,3}), (\d{1,3})\))?, ((?:${MONTHS}) \d{1,2})\s*$`, "m");
export function spotOf(prompt) {
  const m = SPOT.exec(String(prompt || "").split(/\n\n/)[0] || "");
  if (!m) return null;
  const x = m[2] == null ? null : Number(m[2]), y = m[3] == null ? null : Number(m[3]);
  return { place: m[1].trim(), x: x != null && x <= 100 ? x : null, y: y != null && y <= 100 ? y : null, day: m[4] };
}

const clean = (text, max) => String(text || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/·/g, "-")
  .replace(/^\s*(?:#+|[-*+>]|\d{1,3}[.)]|\[[ xX]?\])\s*/, "").replace(/\s+/g, " ").trim().slice(0, max).trim()
  .replace(/[.!]+$/, "");

// Where on its zone's map a spot is, in words, as Willo's app tells journey moments (companion/lore_companion/recall.py
// direction): "south-west", "middle".
export function direction(x, y) {
  const ns = y < 36 ? "north" : y > 64 ? "south" : "", ew = x < 36 ? "west" : x > 64 ? "east" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "middle";
}

// A pin's line: its name, what to remember, where (with the map spot, and its direction in words, when the game gave
// one) and the day. "What Willo keeps" (LOR-666) reads this shape; keep it.
export function pinLine(name, note, spot) {
  const where = spot.place + (spot.x != null && spot.y != null ? ` (${direction(spot.x, spot.y)}, ${spot.x}, ${spot.y})` : "");
  return `${name}${note ? `: ${note}` : ""}${SEP}${where}${SEP}${spot.day}`;
}

// A pin's line read back: {name, note, where, day}, or null for a line that isn't one.
export function pinOf(text) {
  const parts = String(text || "").split(SEP);
  if (parts.length < 3) return null;
  const day = parts.pop(), where = parts.pop(), head = parts.join(SEP);
  const at = head.indexOf(": ");
  return { name: at < 0 ? head : head.slice(0, at), note: at < 0 ? "" : head.slice(at + 2), where, day };
}

// A page's pins, as they're written under its Pins heading: [{name, note, where, day, text, raw}].
export function pinsOf(body) {
  const out = [];
  let under = false;
  for (const raw of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
    const head = /^#{1,6}\s+(.*)$/.exec(raw);
    if (head) { under = head[1].trim().toLowerCase() === PINS_HEADING.toLowerCase(); continue; }
    const item = /^\s*[-*+]\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(raw);
    const pin = under && item && pinOf(item[1].trim());
    if (pin) out.push({ ...pin, text: item[1].trim(), raw });
  }
  return out;
}

// A pin as she says it: its name and its place ("the elite cave in Fargodeep Mine"), the zone too when it's only a
// zone's name; never its map numbers.
const placeOf = where => String(where || "").replace(/ \([^)]*\)$/, "");
export const spoken = pin => {
  const place = placeOf(pin.where);
  const [sub] = place.split(", ");
  return sub && sub.toLowerCase() !== pin.name.toLowerCase() ? `${pin.name} in ${sub}` : place.replace(/^([^,]+), (.+)$/, "$1 in $2");
};
const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const counted = n => (n <= 10 ? COUNT[n] : String(n));

// "What pins do I have?": this character's pins, then their pins for all characters, built here. Typed, each with its
// place, day and note; out loud, three by name and place, then how many more.
export function pinsAnswer(view, { spoken: aloud = false } = {}) {
  const who = view?.current ? view.current.slice(5).split("-")[0] : "";
  const mine = pinsOf(view?.pages?.[view?.current]?.body), all = pinsOf(view?.pages?.account?.body);
  const pins = [...mine, ...all];
  if (!pins.length) return who ? `${who} has no pins yet. Say "pin this spot" where you stand, and I'll keep it.`
    : `You have no pins yet. Say "pin this spot" where you stand, and I'll keep it.`;
  const n = pins.length;
  const head = `${counted(n)} pin${n === 1 ? "" : "s"}${who ? ` for ${who}` : ""}`;
  if (aloud) {
    const said = pins.slice(0, 3).map(spoken);
    const more = n - said.length;
    return `${head}: ${said.join(", ")}${more ? `, and ${counted(more).toLowerCase()} more` : ""}.`;
  }
  const told = pins.slice(0, 10).map(p => `${spoken(p)}${p.where.includes(", ") ? `, ${placeOf(p.where).split(", ").slice(1).join(", ")}` : ""}` +
    `${/\(([a-z-]+),/.exec(p.where) ? ` (${/\(([a-z-]+),/.exec(p.where)[1]})` : ""}, ${p.day}${p.note ? `: ${p.note}` : ""}` +
    (all.includes(p) && who ? " (for all your characters)" : ""));
  return `${head}: ${told.join("; ")}${n > told.length ? `; and ${n - told.length} more in your notebook` : ""}.`;
}
// "Clear all my pins" (the PM, relaying the blind check, 10/18: clear them all, with one confirmation): her question,
// built here, and a yes to it, which takes this character's pins off (one change, so the Notebook tab's Undo brings
// them back).
const CLEAR_ASK = /Say yes and I'll take (?:it|them) off\./;
export function clearAsk(view) {
  const who = view?.current ? view.current.slice(5).split("-")[0] : "";
  const n = pinsOf(view?.pages?.[view?.current || "account"]?.body).length;
  if (!n) return who ? `${who} has no pins to clear.` : "You have no pins to clear.";
  const whose = who ? `${who}'s` : "your";
  const which = n === 1 ? `${who ? whose : "Your"} one pin` : n === 2 ? `Both of ${whose} pins`
    : `All ${counted(n).toLowerCase()} of ${whose} pins`;
  return `${which}? Say yes and I'll take ${n === 1 ? "it" : "them"} off.`;
}
const YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|do it|go ahead|please(?: do)?|clear them|take them off)\b(?![^.?!]*\b(?:not|don'?t|wait)\b)/i;
const NO = /^\s*(?:no|nope|nah|keep|don'?t|wait|never ?mind|cancel|stop|not)\b|^\s*(?:yes|yeah)\b[^.?!]*\b(?:not|don'?t|wait)\b/i;
export const confirmsClear = (question, previous) => YES.test(String(question || "")) && CLEAR_ASK.test(String(previous || ""));
// The answer to her clear-all question, "yes" or "no", or null for anything else.
export function clearTurn(question, previous) {
  if (!CLEAR_ASK.test(String(previous || ""))) return null;
  const q = String(question || "").replace(/’/g, "'");
  return NO.test(q) ? "no" : YES.test(q) ? "yes" : null;
}
// What the site does with that answer, built here whatever the model says (the blind check, 10/18: on Brynn, a yes to
// Húrin's question got "Consider it done" with nothing cleared): {noted} to clear this character's pins, or {answer}.
export function clearReply(view, question, previous) {
  const turn = clearTurn(question, previous);
  if (!turn) return null;
  const who = view?.current ? view.current.slice(5).split("-")[0] : "";
  const asked = /(?:\bof |^)([^\s?]+?)'s (?:one )?pins?\?/.exec(String(previous || ""))?.[1] || "";
  const pins = pinsOf(view?.pages?.[view?.current || "account"]?.body);
  if (turn === "no") return { answer: `All right, I'll keep ${pins.length === 1 ? "it" : "them"}.` };
  if (asked && who && asked !== who) return { answer: `I haven't cleared anything: that was about ${asked}'s pins, and ` +
    `you're on ${who} now.` };
  const noted = clearCall(view);
  return noted ? { noted } : { answer: who ? `${who} has no pins to clear.` : "You have no pins to clear." };
}
// The change a yes makes: every pin on this character's page, read from the page itself (out loud the notebook's view
// numbers only a few lines), in lib/willo-notebook.js notebookCall's shape; or null.
export function clearCall(view) {
  const page = view?.current || "account";
  const targets = pinsOf(view?.pages?.[page]?.body).map(p => ({ page, raw: p.raw, text: p.text, kind: "bullet" }));
  if (!targets.length) return null;
  return { page, op: { op: "remove", targets }, pin: { did: "cleared", name: targets.map(t => pinOf(t.text).name).join(", "),
    who: page === "account" ? "" : page.slice(5).split("-")[0], count: targets.length } };
}

// The notebook's question back when a name fits two lines ("Which one: …, or …?"), with each pin said by its name and
// place, never its raw line with the map's numbers.
export function pinsSaid(say, view) {
  let out = String(say || "");
  for (const page of [view?.current, "account"].filter(Boolean)) {
    for (const pin of pinsOf(view?.pages?.[page]?.body)) out = out.split(pin.text).join(spoken(pin));
  }
  return out;
}

// The numbered lines of the notebook her answer reads (lib/willo-notebook.js notebookView refs) that are pins: under a
// Pins heading on their page, in a pin's shape. {number -> ref}.
export function pinRefs(view) {
  const out = new Map();
  for (const [n, ref] of view?.refs || []) {
    if (!pinOf(ref.text)) continue;
    const body = String(view.pages?.[ref.page]?.body || "").replace(/\r\n?/g, "\n").split("\n");
    const at = body.findIndex(l => l.trim() === ref.raw.trim());
    const heading = body.slice(0, Math.max(0, at)).reverse().find(l => /^#{1,6}\s/.test(l));
    if (heading && heading.replace(/^#+\s*/, "").trim().toLowerCase() === PINS_HEADING.toLowerCase()) out.set(n, ref);
  }
  return out;
}

// What her answer is told about pins, after the notebook's own (lib/willo-notebook.js NOTEBOOK_RULES).
export function pinRules(spot, { spoken = false, adding = false } = {}) {
  return "PINS: their pinned spots are the lines under Pins in NOTEBOOK (name: what to remember · place · day). " +
    (!adding ? "" : spot?.named
      ? `To pin ${spot.place}, the place they named, call notebook_pin with a short name (theirs if they gave one, ` +
        "else the place's own) and what they want to remember; the place and the day are filled in for you. "
      : spot?.saved
      ? `To pin where their last save left them (${spot.place}), call notebook_pin with a short name and what they ` +
        "want to remember; the place and the day are filled in for you. "
      : spot
      ? "To pin where they stand now, call notebook_pin with a short name and what they want to remember; the place " +
        "and the day are filled in for you. "
      : "You don't know where they stand right now, so you can't pin anything: don't call notebook_pin, and say so in " +
        "a line, then that you can when they ask from the add-on's Ask box or with Live game info on in your Settings. ") +
    "To rename a pin, call notebook_update with its new name; to take one out, notebook_remove. A pin's place and day " +
    "are the game's: never change them or make one up. Asked where a pin is, tell its place, the day and its note, and " +
    "which part of the map only when its line names one (\"the south\"), never from what you know of the place. " +
    (spoken ? "Out loud, never say a pin's map numbers. " : "") + "Don't count their pins or other lines unless asked.";
}

// notebook_pin's declaration, provider-neutral like lib/willo-notebook.js notebookTools', for a question that pins
// where they stand, only when Willo's app said where that is. (Offered with the notebook's own tools, never with its
// reminder or move tools: all the offered tools must fit lib/companion-answers.js ACTIONS_MAX_BYTES.)
export function pinTool(spot, intent) {
  if (!spot || !intent.add) return [];
  return [{ name: PIN_TOOL,
    description: spot.named ? `Pin ${spot.place}, the place they named, on this character's page. The place and the day are filled in.`
      : spot.saved ? "Pin where their last save left them, on this character's page. The place and the day are filled in."
      : "Pin where they stand right now, on this character's page. The place and the day are filled in.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "A short name: theirs if they gave one (\"the elite cave\"), else the " +
        "place's own (\"Fargodeep Mine\")." },
      note: { type: "string", description: "What they want to remember about it, in their words (\"the elite inside " +
        "hits hard\"); leave it out when they said nothing." } },
      required: ["name"] } }];
}

// notebook_pin's call, as lib/willo-notebook.js notebookCall gives a change ({page, op}, with pin: what her line
// says), or null for a call that isn't one, or one made without the game's spot.
export function pinCall(call, offered, view, spot) {
  if (call?.name !== PIN_TOOL || !spot || !(offered || []).some(t => t.name === PIN_TOOL)) return null;
  const args = call.args && typeof call.args === "object" ? call.args : {};
  // The name they gave it ("pin Fargodeep Mine as the kobold den") is the pin's, set here (the blind check, 10/18: the
  // model wrote "Fargodeep Mine: the kobold den", 4 runs of 4); its note only when it says something else.
  const given = clean(spot.as, NAME_CHARS);
  const name = given || clean(args.name, NAME_CHARS);
  if (!name) return null;
  const same = (a, b) => a.toLowerCase().replace(/^the\s+/, "") === b.toLowerCase().replace(/^the\s+/, "");
  const note = [clean(args.note, NOTE_CHARS), given ? clean(args.name, NOTE_CHARS) : ""]
    .find(n => n && !same(n, name) && !same(n, spot.place.split(",")[0])) || "";
  return { page: view.current || "account", op: { op: "add", kind: "note", items: [pinLine(name, note, spot)],
    heading: PINS_HEADING }, pin: { did: "pinned", name, note, where: spot.place, ...(spot.saved ? { saved: true } : {}) } };
}

// The notebook's own change (notebookCall's {page, op}) when it renames a pin: the model's words give its name (and a
// note, when it wrote one), the place and the day stay the game's; when it takes pins out, her line names them as
// pins. Anything else comes back as it was.
// The new name in the player's own words when the question has it ("Rename it to Kobold den": never "the kobold den").
function theirs(name, question) {
  const q = String(question || "");
  for (const want of [name, name.replace(/^the\s+/i, "")]) {
    const at = want ? q.toLowerCase().indexOf(want.toLowerCase()) : -1;
    if (at >= 0) return q.slice(at, at + want.length);
  }
  return name;
}

export function pinUpdate(view, noted, question = "") {
  if (noted?.op?.op === "remove") {
    const pins = new Set([...pinRefs(view).values()].map(r => r.raw));
    const gone = (noted.op.targets || []).filter(t => pins.has(t.raw)).map(t => pinOf(t.text));
    return gone.length && gone.length === noted.op.targets.length
      ? { ...noted, pin: { did: "removed", name: gone.map(p => p.name).join(", "), where: gone[0].where, count: gone.length } }
      : noted;
  }
  if (noted?.op?.op !== "update") return noted;
  const target = noted.op.target;
  const pin = [...pinRefs(view).values()].some(r => r.raw === target?.raw) && pinOf(target.text);
  if (!pin) return noted;
  const said = String(noted.op.text || "").split(SEP)[0];
  const at = said.indexOf(": ");
  const name = theirs(clean(at < 0 ? said : said.slice(0, at), NAME_CHARS), question) || pin.name;
  const note = at < 0 ? pin.note : clean(said.slice(at + 2), NOTE_CHARS);
  return { ...noted, op: { ...noted.op, text: `${name}${note ? `: ${note}` : ""}${SEP}${pin.where}${SEP}${pin.day}` },
    pin: { did: "renamed", name, was: pin.name, where: pin.where } };
}

const where = text => text.replace(/ \([a-z-]+, \d{1,3}, \d{1,3}\)$/, "").replace(/^([^,]+), (.+)$/, "$1 in $2");
// Her line for a pin she wrote, from what was written; then whatever else her answer said that doesn't claim a write.
const FILLER = /^(?:done|all set|there you go|got it|okay|ok|sure|of course|gone|poof)[.!]*$/i;
const CLAIM = /\b(?:pinned|unpinned|cleared|marked|saved|noted|added|renamed|changed|updated|written|wrote|removed|deleted|taken|remember(?:ed)?)\b/i;
export function pinnedLine(answer, pin) {
  const line = pin.did === "cleared" ? `Cleared ${pin.who ? `${pin.who}'s` : "your"} pins: ${pin.name}. Undo in the ` +
      "Notebook tab brings them back."
    : pin.did === "removed" ? (pin.count > 1 ? `Unpinned: ${pin.name}.` : `Unpinned: ${pin.name}, ${where(pin.where)}.`)
    : pin.did === "renamed" ? `Renamed it ${pin.name}: ${where(pin.where)}.`
    : `Pinned: ${pin.name === pin.where.split(",")[0] ? where(pin.where) : `${pin.name}, ${where(pin.where)}`}` +
      `${pin.saved ? ", as of your last save" : ""}.` +
      (pin.note ? ` ${pin.note.charAt(0).toUpperCase()}${pin.note.slice(1)}.` : "");
  // Clearing them all, the site's line stands alone: the model's own "Consider them gone, Húrin…" after it only said it
  // again (the vision session, 10/18).
  if (pin.did === "cleared") return line;
  const rest = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || [])
    .filter(t => /\p{L}/u.test(t) && !CLAIM.test(t) && !/\?\s*$/.test(t) && !FILLER.test(t.trim())).join("").trim();
  return rest ? `${line} ${rest}` : line;
}
export const NO_PIN_LINE = "I couldn't find that pin. Tell me its name as it reads under Pins in your notebook.";

// Asked to pin where they stand when Willo's app doesn't know it (typed in her window, or out loud without Live game
// info): nothing is pinned, and her line says so and how she could (the quality bar's case 15), built here, never the
// model's.
export const NO_SPOT_LINE = "I can't tell exactly where you're standing right now, so I haven't pinned it. Ask me " +
  "from the add-on's Ask box, or turn on Live game info in my Settings, and I'll pin the spot.";
// A pin asked for and none written (no tool called): her sentences that claim one go (case 29), and if nothing's left,
// a true line.
const PIN_CLAIM = /\b(?:pinned|unpinned)\b|\bI(?:'ve|\s+have|\s+just)?\s+(?:marked|saved|dropped|set|placed|added)\b[^.?!]{0,40}\b(?:pin|spot|place)\b/i;
export function unpinned(answer) {
  const sentences = String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || [];
  const kept = sentences.filter(t => !PIN_CLAIM.test(t)).join("").trim();
  return kept || "I haven't pinned it yet. Tell me what to call it, and I will.";
}
