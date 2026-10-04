// Journey records (LOR-181): the text the add-on's "Copy my journey record" makes (addon/LoreForever/JourneyRecord.lua),
// read back into the facts a player profile shows (lib/profiles.js). Players paste it on /account, so it's untrusted:
// it's size-capped, read line by line against the add-on's own strings, and only what the profile needs is kept, with
// a cap on every list. The raw text is never stored. Group content ends in "with Dwarf Priest, Orc Warrior" (the
// add-on records other players' race and class, never their names, but a pasted record could say anything): that
// part is dropped and only counted. A killer named by "slain by" is kept only when the record also lists it as a foe,
// so another player's name never is. Records in the bundled languages (deDE, frFR, esES, ptBR) are read through
// their strings (LOCALES, from data/i18n/<locale>/ui.json); a string a pack lacks shows in English, so English is
// always tried too. Kept outside functions/ so Pages doesn't route it.

export const MAX_BYTES = 64 * 1024;   // the add-on keeps a record under 30 KB

// The add-on's strings that shape a record, per language. sections maps each section title to its key in
// JourneyRecord.lua's SECTIONS ("places" has two titles: a whole record, and one that started mid-life).
const LOCALES = {
  en: {
    header: "Journey record: %s", level: "Level %d", since: "Recorded since %s.",
    sinceFrom: "Recorded since %s, from level %d.", with: "with %s", reached: "Reached level %d", slain: "slain by %s",
    rep: "%s with %s", rewardFor: "reward for %s", questReward: "Quest reward", died: "Died", dungeon: "dungeon",
    fought: "Most fought", cut: "Older entries were left out to keep this record short.",
    ranks: { "elite": "elite", "rare": "rare", "rare elite": "rareelite", "world boss": "worldboss" },
    sections: {
      "New places, in order": "places", "Places recorded, in order": "places", "Quests done": "quests",
      "People met": "people", "Bosses defeated": "bosses", "Notable kills": "kills", "Loot and quest rewards": "loot",
      "Level-ups": "levels", "Spells learned": "spells", "Mounts": "mounts", "Profession milestones": "profs",
      "Reputation": "rep", "Deaths": "deaths", "Books read": "books", "Screenshots": "shots",
    },
  },
  de: {
    header: "Reiseaufzeichnung: %s", level: "Stufe %d", since: "Aufgezeichnet seit %s.",
    sinceFrom: "Aufgezeichnet seit %s, ab Stufe %d.", with: "mit %s", reached: "Stufe %d erreicht",
    slain: "getötet von %s", rep: "%s mit %s", rewardFor: "Belohnung für %s", questReward: "Questbelohnung",
    died: "Gestorben", dungeon: "Dungeon", fought: "Am meisten bekämpft",
    cut: "Ältere Einträge wurden weggelassen, um diese Aufzeichnung kurz zu halten.",
    ranks: { "Elite": "elite", "selten": "rare", "Seltener Elite": "rareelite", "Weltboss": "worldboss" },
    sections: {
      "Neue Orte, der Reihe nach": "places", "Aufgezeichnete Orte, in Reihenfolge": "places",
      "Abgeschlossene Quests": "quests", "Getroffene Personen": "people", "Bosse besiegt": "bosses",
      "Bemerkenswerte Siege": "kills", "Beute- und Questbelohnungen": "loot", "Stufenaufstiege": "levels",
      "Erlernte Zauber": "spells", "Reittiere": "mounts", "Berufsmeilensteine": "profs", "Ruf": "rep", "Tode": "deaths",
      "Gelesene Bücher": "books", "Screenshots": "shots",
    },
  },
  fr: {
    header: "Rapport de périple : %s", level: "Niveau %d", since: "Enregistré depuis le %s.",
    sinceFrom: "Enregistré depuis le %s, à partir du niveau %d.", with: "avec %s", reached: "Niveau %d atteint",
    slain: "tué par %s", rep: "%s avec %s", rewardFor: "récompense pour %s", questReward: "Récompense de quête",
    died: "Mort", dungeon: "donjon", fought: "Les plus combattus",
    cut: "Les entrées plus anciennes ont été ignorées pour garder cet historique court.",
    ranks: { "élite": "elite", "rare": "rare", "rare élite": "rareelite", "boss mondial": "worldboss" },
    sections: {
      "Nouveaux lieux, dans l'ordre": "places", "Lieux enregistrés, dans l'ordre": "places",
      "Quêtes terminées": "quests", "Personnes rencontrées": "people", "Boss vaincus": "bosses",
      "Victoires notables": "kills", "Butin et récompenses de quête": "loot", "Montées de niveau": "levels",
      "Sorts appris": "spells", "Montures": "mounts", "Étapes de métier": "profs", "Réputation": "rep", "Morts": "deaths",
      "Livres lus": "books", "Captures d'écran": "shots",
    },
  },
  es: {
    header: "Registro de viaje: %s", level: "Nivel %d", since: "Registrado desde %s.",
    sinceFrom: "Registrado desde %s, a partir del nivel %d.", with: "con %s", reached: "Alcanzado el nivel %d",
    slain: "asesinado por %s", rep: "%s con %s", rewardFor: "recompensa de %s", questReward: "Recompensa de misión",
    died: "Ha muerto", dungeon: "mazmorra", fought: "Más combatidos",
    cut: "Se omitieron las entradas más antiguas para mantener este registro breve.",
    ranks: { "élite": "elite", "raro": "rare", "élite raro": "rareelite", "jefe del mundo": "worldboss" },
    sections: {
      "Nuevos lugares, en orden": "places", "Lugares grabados, en orden": "places", "Misiones completadas": "quests",
      "Personas conocidas": "people", "Jefes derrotados": "bosses", "Muertes destacadas": "kills",
      "Botín y recompensas de misión": "loot", "Subidas de nivel": "levels", "Hechizos aprendidos": "spells",
      "Monturas": "mounts", "Hitos de profesión": "profs", "Reputación": "rep", "Muertes": "deaths",
      "Libros leídos": "books", "Capturas de pantalla": "shots",
    },
  },
  pt: {
    header: "Registro de jornada: %s", level: "Nível %d", since: "Registrado desde %s.",
    sinceFrom: "Registrado desde %s, a partir do nível %d.", with: "com %s", reached: "Alcançou o nível %d",
    slain: "morto por %s", rep: "%s com %s", rewardFor: "recompensa de %s", questReward: "Recompensa de missão",
    died: "Morreu", dungeon: "masmorra", fought: "Mais enfrentados",
    cut: "Entradas mais antigas foram omitidas para manter este registro curto.",
    ranks: { "elite": "elite", "raro": "rare", "raro elite": "rareelite", "chefe mundial": "worldboss" },
    sections: {
      "Novos locais, em ordem": "places", "Lugares registrados, em ordem": "places", "Missões concluídas": "quests",
      "Pessoas encontradas": "people", "Chefes derrotados": "bosses", "Abates notáveis": "kills",
      "Saques e recompensas de missões": "loot", "Subidas de nível": "levels", "Feitiços aprendidos": "spells",
      "Montarias": "mounts", "Marcos de profissão": "profs", "Reputação": "rep", "Mortes": "deaths",
      "Livros lidos": "books", "Capturas de tela": "shots",
    },
  },
};

// Class names as the game prints them (both genders where the language has two), for the favorite spec list.
const CLASSES = {
  WARRIOR: ["Warrior", "Krieger", "Kriegerin", "Guerrier", "Guerrière", "Guerrero", "Guerrera", "Guerreiro", "Guerreira"],
  PALADIN: ["Paladin", "Paladín", "Paladino", "Paladina"],
  HUNTER: ["Hunter", "Jäger", "Jägerin", "Chasseur", "Chasseresse", "Cazador", "Cazadora", "Caçador", "Caçadora"],
  ROGUE: ["Rogue", "Schurke", "Schurkin", "Voleur", "Voleuse", "Pícaro", "Pícara", "Ladino", "Ladina"],
  PRIEST: ["Priest", "Priester", "Priesterin", "Prêtre", "Prêtresse", "Sacerdote", "Sacerdotisa"],
  SHAMAN: ["Shaman", "Schamane", "Schamanin", "Chaman", "Chamane", "Chamán", "Xamã"],
  MAGE: ["Mage", "Magier", "Magierin", "Mago", "Maga"],
  WARLOCK: ["Warlock", "Hexenmeister", "Hexenmeisterin", "Démoniste", "Brujo", "Bruja", "Bruxo", "Bruxa"],
  DRUID: ["Druid", "Druide", "Druidin", "Druidesse", "Druida"],
};

// Classic's talent trees, for "favorite spec" (lib/profiles.js keeps the player's pick only if it's one of these).
export const SPECS = {
  WARRIOR: ["Arms", "Fury", "Protection"], PALADIN: ["Holy", "Protection", "Retribution"],
  HUNTER: ["Beast Mastery", "Marksmanship", "Survival"], ROGUE: ["Assassination", "Combat", "Subtlety"],
  PRIEST: ["Discipline", "Holy", "Shadow"], SHAMAN: ["Elemental", "Enhancement", "Restoration"],
  MAGE: ["Arcane", "Fire", "Frost"], WARLOCK: ["Affliction", "Demonology", "Destruction"],
  DRUID: ["Balance", "Feral Combat", "Restoration"],
};

const FACTIONS = new Map(Object.entries({ Alliance: "alliance", Allianz: "alliance", Alianza: "alliance",
                                          "Aliança": "alliance", Horde: "horde", Horda: "horde" }));

// Item quality words (the game's ITEM_QUALITYn_DESC) in every bundled language. Case matters: in German "Selten" is
// uncommon, while the kill rank "selten" is rare.
const QUALITY = new Map(Object.entries({
  Poor: 0, Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5,
  Schlecht: 0, Verbreitet: 1, Selten: 2, Rar: 3, Episch: 4, "Legendär": 5,
  "Médiocre": 0, Classique: 1, Bonne: 2, "Épique": 4, "Légendaire": 5,
  Pobre: 0, "Común": 1, "Poco común": 2, Raro: 3, "Épico": 4, Legendario: 5,
  Inferior: 0, Comum: 1, Incomum: 2, "Lendário": 5,
}));

// How much of each list is kept (newest entries win when a list is longer).
const CAP = { places: 300, quests: 400, people: 300, bosses: 100, kills: 150, loot: 150, levels: 80, spells: 80,
              mounts: 30, profs: 20, rep: 60, deaths: 150, books: 80, fought: 10 };
const MAX_TEXT = 80;   // characters in any one name

export class RecordError extends Error {}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "%s with %s" -> a regexp for the whole string, and where each argument goes ("%2$s" can reorder them).
function compile(fmt) {
  const order = [];
  let re = "", last = 0, n = 0;
  for (const m of fmt.matchAll(/%(?:(\d)\$)?([sd])/g)) {
    re += escapeRe(fmt.slice(last, m.index)) + (m[2] === "d" ? "(\\d+)" : "(.+?)");
    order.push(m[1] ? Number(m[1]) - 1 : n);
    n++;
    last = m.index + m[0].length;
  }
  return { re: new RegExp("^" + re + escapeRe(fmt.slice(last)) + "$", "su"), order };
}

function match(c, s) {
  const m = c.re.exec(s);
  if (!m) return null;
  const args = [];
  c.order.forEach((to, i) => { args[to] = m[i + 1]; });
  return args;
}

const FORMATS = ["header", "level", "since", "sinceFrom", "with", "reached", "slain", "rep", "rewardFor"];
const COMPILED = Object.fromEntries(Object.entries(LOCALES).map(([code, L]) => [code,
  { code, ...Object.fromEntries(FORMATS.map(k => [k, compile(L[k])])) }]));
// Maps, not objects: a pasted "constructor" or "__proto__" must not find anything.
const merged = key => new Map(Object.values(LOCALES).flatMap(L => Object.entries(L[key])));
const anyOf = key => new Set(Object.values(LOCALES).map(L => L[key]));
const SECTIONS = merged("sections");
const RANKS = merged("ranks");
const FOUGHT = anyOf("fought"), CUT = anyOf("cut"), DUNGEON = anyOf("dungeon"), DIED = anyOf("died");
const QUEST_REWARD = anyOf("questReward");
const CLASS_OF = new Map(Object.entries(CLASSES).flatMap(([key, names]) => names.map(n => [n, key])));
// A line that starts the sections, so a paste that lost its blank lines still ends the head there.
const startsSections = line => SECTIONS.has(line) || FOUGHT.has(line) || CUT.has(line) || line.startsWith("- ");

// The record's language first, then English (a string a language pack lacks shows in English).
const matchIn = (T, key, s) => match(T[key], s) || (T.code !== "en" ? match(COMPILED.en[key], s) : null);

// Control characters and the invisible ones (zero-width, bidi controls, line separators, the byte order mark).
const INVISIBLE = new RegExp("[" + [[0x0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]", "g");

// A name as stored: no control or invisible characters, single spaces, at most MAX_TEXT characters.
const tidy = s => {
  const t = String(s ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return t.length <= MAX_TEXT ? t : Array.from(t).slice(0, MAX_TEXT).join("");   // cut by characters, not halves
};
const num = s => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : 0;
};

// "Sentinel Hill, Westfall" or "Westfall".
function place(text) {
  const t = tidy(text);
  const i = t.lastIndexOf(", ");
  return i < 0 ? { zone: t } : { sub: t.slice(0, i), zone: t.slice(i + 2) };
}
const at = text => text ? place(text) : {};

// An entry line, "- Oct 01 14:23  The Deadmines · dungeon" (two spaces after the time; "-   text" without one), as
// its " · " parts without the group part, and whether it had one.
function entry(line, T) {
  const m = /^-\s(.*?)\s\s(.*)$/s.exec(line);
  // A paste that squeezed the double space: drop what looks like the time ("Oct 01 14:23").
  const text = m ? m[2] : line.replace(/^-\s*/, "").replace(/^\S{2,6} \d{1,2} \d{1,2}:\d{2} /, "");
  const parts = text.split(" · ").map(s => s.trim()).filter(Boolean);
  const grouped = parts.length > 1 && Boolean(matchIn(T, "with", parts[parts.length - 1]));
  if (grouped) parts.pop();
  return { parts, grouped };
}

// Reads a pasted record. Returns the profile's facts (plain JSON), or throws RecordError with a code: "empty",
// "too-big" or "not-a-record".
export function parseRecord(input) {
  const raw = typeof input === "string" ? input : "";
  if (!raw.trim()) throw new RecordError(input == null || input === "" || typeof input === "string" ? "empty" : "not-a-record");
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new RecordError("too-big");
  // Tabs and other control characters go with the invisible ones; lines are trimmed.
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(INVISIBLE, "").trim());

  // The record's first line says its language. Anything pasted above it is ignored.
  let start = -1, T = null, who = null;
  for (let i = 0; i < Math.min(lines.length, 40) && start < 0; i++) {
    for (const C of Object.values(COMPILED)) {
      const m = match(C.header, lines[i]);
      if (m) { start = i; T = C; who = m[0]; break; }
    }
  }
  if (start < 0) throw new RecordError("not-a-record");

  const dash = who.lastIndexOf(" - ");
  const data = {
    v: 1, locale: T.code,
    name: tidy(dash < 0 ? who : who.slice(0, dash)), realm: dash < 0 ? null : tidy(who.slice(dash + 3)) || null,
    level: null, race: null, className: null, classKey: null, faction: null, factionKey: null,
    since: null, fromLevel: null, cut: false, totals: null,
    places: [], quests: [], people: [], bosses: [], kills: [], loot: [], levels: [], spells: [], mounts: [],
    profs: [], rep: [], deaths: [], books: [], shots: 0, fought: [], grouped: 0,
  };
  if (!data.name) throw new RecordError("not-a-record");

  // The head: the character sheet, when the record starts and the totals line (each may be missing).
  let i = start + 1;
  for (; i < lines.length && lines[i] && !startsSections(lines[i]); i++) {
    const line = lines[i];
    const sh = sheet(line, T);
    if (sh) { Object.assign(data, sh); continue; }
    const from = matchIn(T, "sinceFrom", line);
    if (from) { data.since = tidy(from[0]); data.fromLevel = num(from[1]) || null; continue; }
    const since = matchIn(T, "since", line);
    if (since) { data.since = tidy(since[0]); continue; }
    const counts = line.split(" · ").map(p => /\d+/.exec(p));
    if (counts.length === 5 && counts.every(Boolean)) {
      data.totals = Object.fromEntries(["quests", "places", "people", "foes", "bosses"].map((k, j) => [k, num(counts[j][0])]));
    }
  }

  // The sections: a title line, then its "- " entries. "Most fought" is one comma-separated line.
  let section = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { section = null; continue; }
    if (CUT.has(line)) { data.cut = true; continue; }
    if (SECTIONS.has(line)) { section = SECTIONS.get(line); continue; }
    if (FOUGHT.has(line)) { section = "fought"; continue; }
    if (section === "fought") {
      for (const m of line.matchAll(/(?:^|, )([^,]+?): (\d+)(?=, |$)/g)) data.fought.push({ name: tidy(m[1]), n: num(m[2]) });
      continue;
    }
    if (!section || !line.startsWith("-")) continue;
    const { parts, grouped } = entry(line, T);
    if (!parts.length) continue;
    if (grouped) data.grouped++;
    read(section, parts, data, T);
  }

  // A killer the record doesn't also list as a foe is dropped: "slain by" could name another player.
  const foes = new Set([...data.fought, ...data.kills, ...data.bosses].map(f => f.name));
  for (const d of data.deaths) if (d.by && !foes.has(d.by)) delete d.by;
  for (const [k, n] of Object.entries(CAP)) if (data[k].length > n) data[k] = data[k].slice(-n);
  if (!data.level) data.level = data.levels.reduce((a, l) => Math.max(a, l.level), 0) || null;
  data.totals ||= { quests: data.quests.length, places: data.places.length, people: data.people.length,
                    foes: data.fought.length, bosses: data.bosses.length };
  return data;
}

// "Level 24 Night Elf Druid, Alliance": the level, race and class, then the faction after the last comma.
function sheet(line, T) {
  const comma = line.lastIndexOf(", ");
  const head = comma < 0 ? line : line.slice(0, comma);
  const faction = comma < 0 ? null : tidy(line.slice(comma + 2));
  // "Level %d" is "Stufe %d", "Niveau %d" and so on: try it on the first one to three words.
  const words = head.split(" ");
  let level = null, rest = "";
  for (let n = 1; n <= Math.min(3, words.length) && level === null; n++) {
    const m = matchIn(T, "level", words.slice(0, n).join(" "));
    if (m) { level = num(m[0]); rest = words.slice(n).join(" "); }
  }
  if (level === null) return null;
  const out = { level: level || null, faction: faction || null, factionKey: FACTIONS.get(faction) || null };
  // The class is the last word; the race is what's before it.
  const w = rest.split(" ").filter(Boolean);
  const cls = w[w.length - 1];
  if (cls && CLASS_OF.has(cls)) return { ...out, className: tidy(cls), classKey: CLASS_OF.get(cls), race: tidy(w.slice(0, -1).join(" ")) || null };
  return { ...out, race: tidy(rest) || null };
}

// One entry into its section's list.
function read(section, parts, data, T) {
  const [first, ...rest] = parts;
  const name = tidy(first);
  switch (section) {
    case "places":
      data.places.push({ ...place(first), ...(rest.some(p => DUNGEON.has(p)) ? { dungeon: true } : {}) });
      break;
    case "quests": data.quests.push({ title: name, ...at(rest[0]) }); break;
    case "people": data.people.push({ name, ...at(rest[0]) }); break;
    case "bosses": data.bosses.push({ name, ...at(rest[0]) }); break;
    case "kills": {
      const rank = RANKS.get(rest[0]);
      data.kills.push({ name, rank: rank || null, ...at(rank ? rest[1] : rest[0]) });
      break;
    }
    case "loot": {
      // The item, its quality, "reward for <quest>" (or "Quest reward"), then the place; each after the item optional.
      let j = 0;
      const quality = QUALITY.get(rest[j]);
      if (quality !== undefined) j++;
      const reward = rest[j] !== undefined && (QUEST_REWARD.has(rest[j]) || Boolean(matchIn(T, "rewardFor", rest[j])));
      if (reward) j++;
      data.loot.push({ name, quality: quality ?? null, ...(reward ? { reward: true } : {}), ...at(rest[j]) });
      break;
    }
    case "levels": {
      const m = matchIn(T, "reached", first);
      if (m) data.levels.push({ level: num(m[0]), ...at(rest[0]) });
      break;
    }
    case "spells": data.spells.push({ name }); break;
    case "mounts": data.mounts.push({ name, ...at(rest[0]) }); break;
    case "profs": {
      const m = /^(.*\S)\s+(\d+)$/.exec(first);
      if (!m) break;
      const prof = tidy(m[1]), rank = num(m[2]);
      const had = data.profs.find(p => p.name === prof);
      if (had) had.rank = Math.max(had.rank, rank); else data.profs.push({ name: prof, rank });
      break;
    }
    case "rep": {
      const m = matchIn(T, "rep", first);
      if (!m) break;
      const faction = tidy(m[1]);
      data.rep = data.rep.filter(r => r.faction !== faction);   // the latest standing wins
      data.rep.push({ faction, standing: tidy(m[0]) });
      break;
    }
    case "deaths": {
      // Where (or "Died" when the game didn't say), then "slain by X" when it did.
      const slain = parts.map(p => matchIn(T, "slain", p)).find(Boolean);
      const where = !DIED.has(first) && !matchIn(T, "slain", first);
      data.deaths.push({ ...(where ? place(first) : {}), ...(slain ? { by: tidy(slain[0]) } : {}) });
      break;
    }
    case "books": data.books.push({ title: tidy(first.replace(/^"(.*)"$/s, "$1")), ...at(rest[0]) }); break;
    case "shots": data.shots++; break;
  }
}
