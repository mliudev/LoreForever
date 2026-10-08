// Journey records (LOR-181): the text the add-on's "Copy my journey record" makes (addon/LoreForever/JourneyRecord.lua),
// read back into the facts a player profile shows (lib/profiles.js). Players paste it on /account, so it's untrusted:
// it's size-capped, read line by line against the add-on's own strings, and only what the profile needs is kept, with
// a cap on every list. The raw text is never stored. Group content ends in "with Dwarf Priest, Orc Warrior" (the
// add-on records other players' race and class, never their names, but a pasted record could say anything): that
// part is dropped and only counted. A killer named by "slain by" is kept only when the record also lists it as a foe,
// so another player's name never is. Records in the bundled languages (deDE, frFR, esES, ptBR) are read through
// their strings (LOCALES, from data/i18n/<locale>/ui.json); a string a pack lacks shows in English, so English is
// always tried too. Kept outside functions/ so Pages doesn't route it.
//
// The moments in time order (LOR-248): each entry line starts with when it happened ("Oct 01 14:23"). The sections
// split them up, so `timeline` puts them back in order, as [section, index in it, day] with only the day
// ("2026-10-01"): the profile shows the journey moment by moment, never the hour someone played.

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
    stats: {
      yards: "Yards walked: %d", slain: "Foes slain: %d", elites: "Elites slain: %d", rares: "Rares slain: %d",
      deaths: "Deaths: %d", recorded: "Hours recorded: %s", played: "Hours played: %s",
      ride: "Yards ridden: %d", swim: "Yards swum: %d", flown: "Yards flown: %d", flights: "Flights taken: %d",
      flownTo: "Places flown to: %d", boats: "Boat trips: %d", fish: "Fish caught: %d", days: "Days played: %d",
      best: "Longest play streak: %d", words: "Words of lore: %d", heard: "Narrations heard: %d",
    },
    sections: {
      "New places, in order": "places", "Places recorded, in order": "places", "Quests done": "quests",
      "People met": "people", "Bosses defeated": "bosses", "Notable kills": "kills", "Loot and quest rewards": "loot",
      "Level-ups": "levels", "Spells learned": "spells", "Mounts": "mounts", "Profession milestones": "profs",
      "Reputation": "rep", "Deaths": "deaths", "Books read": "books", "Screenshots": "shots",
      "Journey stats": "stats", "Yards walked, by land": "walk", "Foes slain, by kind": "kinds",
      "Slain by": "killers", "Most loyal patrons": "patrons", "Inns you've called home": "inns",
      "Flights, by destination": "destinations", "Minutes spent, by land": "time",
    },
    causes: { "drowned": "drown", "lost in deep water": "fatigue" },
  },
  de: {
    header: "Reiseaufzeichnung: %s", level: "Stufe %d", since: "Aufgezeichnet seit %s.",
    sinceFrom: "Aufgezeichnet seit %s, ab Stufe %d.", with: "mit %s", reached: "Stufe %d erreicht",
    slain: "getötet von %s", rep: "%s mit %s", rewardFor: "Belohnung für %s", questReward: "Questbelohnung",
    died: "Gestorben", dungeon: "Dungeon", fought: "Am meisten bekämpft",
    cut: "Ältere Einträge wurden weggelassen, um diese Aufzeichnung kurz zu halten.",
    ranks: { "Elite": "elite", "selten": "rare", "Seltener Elite": "rareelite", "Weltboss": "worldboss" },
    stats: {   // the German client calls yards "Meter"
      yards: "Gelaufene Meter: %d", slain: "Feinde getötet: %d", elites: "Elitegegner getötet: %d",
      rares: "Seltene Gegner getötet: %d", deaths: "Tode: %d", recorded: "Aufgezeichnete Stunden: %s",
      played: "Gespielte Stunden: %s",
      ride: "Gerittene Meter: %d", swim: "Geschwommene Meter: %d", flown: "Geflogene Meter: %d",
      flights: "Flüge angetreten: %d", flownTo: "Angeflogene Orte: %d", boats: "Bootsfahrten: %d",
      fish: "Gefangene Fische: %d", days: "Gespielte Tage: %d", best: "Längste Spielserie: %d",
      words: "Lore-Wörter: %d", heard: "Erzählungen gehört: %d",
    },
    causes: { "ertrunken": "drown", "in tiefem Wasser verschollen": "fatigue" },
    sections: {
      "Reisestatistiken": "stats", "Gelaufene Meter, nach Land": "walk", "Getötete Feinde, nach Art": "kinds",
      "Getötet von": "killers", "Treueste Auftraggeber": "patrons",
      "Gasthäuser, die Ihr Euer Zuhause genannt habt": "inns", "Flüge, nach Zielort": "destinations",
      "Verbrachte Minuten, nach Land": "time",
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
    stats: {   // the French client calls yards "mètres"
      yards: "Mètres parcourus à pied : %d", slain: "Ennemis tués : %d", elites: "Élites tués : %d",
      rares: "Rares tués : %d", deaths: "Morts : %d", recorded: "Heures enregistrées : %s", played: "Heures jouées : %s",
      ride: "Mètres parcourus à monture : %d", swim: "Mètres parcourus à la nage : %d",
      flown: "Mètres parcourus en vol : %d", flights: "Vols effectués : %d", flownTo: "Destinations de vol atteintes : %d",
      boats: "Trajets en bateau : %d", fish: "Poissons pêchés : %d", days: "Jours joués : %d",
      best: "Plus longue série de jeu : %d", words: "Mots d'histoire : %d", heard: "Récits écoutés : %d",
    },
    causes: { "noyé": "drown", "perdu en eaux profondes": "fatigue" },
    sections: {
      "Statistiques de voyage": "stats", "Mètres parcourus à pied, par région": "walk", "Ennemis tués, par type": "kinds",
      "Tué par": "killers", "Commanditaires les plus fidèles": "patrons", "Auberges qui ont été votre foyer": "inns",
      "Vols, par destination": "destinations", "Minutes passées, par région": "time",
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
    stats: {
      yards: "Yardas recorridas: %d", slain: "Enemigos abatidos: %d", elites: "Élites abatidos: %d",
      rares: "Raros abatidos: %d", deaths: "Muertes: %d", recorded: "Horas registradas: %s", played: "Horas jugadas: %s",
      ride: "Yardas montado: %d", swim: "Yardas nadadas: %d", flown: "Yardas voladas: %d", flights: "Vuelos tomados: %d",
      flownTo: "Lugares a los que has volado: %d", boats: "Viajes en barco: %d", fish: "Peces pescados: %d",
      days: "Días jugados: %d", best: "Racha de juego más larga: %d", words: "Palabras de historia: %d",
      heard: "Narraciones escuchadas: %d",
    },
    causes: { "ahogado": "drown", "perdido en aguas profundas": "fatigue" },
    sections: {
      "Estadísticas del viaje": "stats", "Yardas recorridas, por territorio": "walk",
      "Enemigos abatidos, por tipo": "kinds",
      "Asesinado por": "killers", "Mecenas más fieles": "patrons", "Posadas que has considerado tu hogar": "inns",
      "Vuelos, por destino": "destinations", "Minutos pasados, por territorio": "time",
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
    stats: {
      yards: "Jardas caminhadas: %d", slain: "Inimigos derrotados: %d", elites: "Elites derrotados: %d",
      rares: "Raros derrotados: %d", deaths: "Mortes: %d", recorded: "Horas registradas: %s", played: "Horas jogadas: %s",
      ride: "Jardas cavalgadas: %d", swim: "Jardas nadadas: %d", flown: "Jardas voadas: %d",
      flights: "Voos realizados: %d", flownTo: "Lugares para onde voou: %d", boats: "Viagens de barco: %d",
      fish: "Peixes pescados: %d", days: "Dias jogados: %d", best: "Maior sequência de jogo: %d",
      words: "Palavras de história: %d", heard: "Narrações ouvidas: %d",
    },
    causes: { "afogado": "drown", "perdido em águas profundas": "fatigue" },
    sections: {
      "Estatísticas da jornada": "stats", "Jardas caminhadas, por território": "walk",
      "Inimigos derrotados, por tipo": "kinds",
      "Abatido por": "killers", "Patronos mais fiéis": "patrons", "Estalagens que você chamou de lar": "inns",
      "Voos, por destino": "destinations", "Minutos gastos, por terra": "time",
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
// The journey stats' lists (the add-on prints at most 30 lands, 12 kinds and 10 of the others).
const STAT_CAP = { walk: 40, kinds: 20, time: 40, killers: 10, patrons: 10, inns: 10, destinations: 10 };
const MAX_TEXT = 80;   // characters in any one name

// The sections that are moments on the profile's timeline, in the order moments of the same minute go (you reach a
// place, meet someone there, finish their quest, get its reward).
export const TIMELINE = ["places", "people", "quests", "bosses", "kills", "loot", "levels", "mounts", "rep", "books", "deaths"];

// The game's date() prints English month names whatever the client's language ("Oct 01 14:23").
const MONTHS = new Map(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => [m, i]));
const AHEAD = 2 * 86400e3;   // a player's clock can be this far ahead of the server's

// "Oct 01 14:23" as minutes (the player's own clock, kept as if UTC), or null. The record has no year: it's the latest
// one that doesn't put the moment in the future.
function stamp(text, now) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}) (\d{1,2}):(\d{2})$/.exec(text || "");
  if (!m || !MONTHS.has(m[1])) return null;
  const at = y => Date.UTC(y, MONTHS.get(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  const year = now.getUTCFullYear();
  const t = at(year) > now.getTime() + AHEAD ? at(year - 1) : at(year);
  return Number.isFinite(t) ? t / 60000 : null;
}

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
  { code, ...Object.fromEntries(FORMATS.map(k => [k, compile(L[k])])),
    stats: Object.entries(L.stats).map(([k, f]) => [k, compile(f)]) }]));
// "Journey stats" (LOR-246): the add-on always prints these six lines first, in this order (JourneyRecord.lua numbers),
// so one worded in a way this file doesn't know yet (a newer translation) is still read by its place. The lines after
// them (hours played, LOR-262's) come only when they have something, so they're read by their words.
const STAT_ORDER = ["yards", "slain", "elites", "rares", "deaths", "recorded"];
const STAT_HOURS = new Set(["recorded", "played"]);
// The journey stats' "Name: n" lists, each item's shape ({ name, n } unless said).
const STAT_LISTS = {
  walk: (name, n) => ({ zone: name, yards: num(n, 1e9) }), kinds: (name, n) => ({ kind: name, n: num(n) }),
  time: (name, n) => ({ zone: name, minutes: num(n) }), killers: null, patrons: null, inns: null, destinations: null,
};
const STAT_LINE = /^-\s*[^:]{1,60}:\s*[\d.,]+$/;
// Maps, not objects: a pasted "constructor" or "__proto__" must not find anything.
const merged = key => new Map(Object.values(LOCALES).flatMap(L => Object.entries(L[key])));
const anyOf = key => new Set(Object.values(LOCALES).map(L => L[key]));
const SECTIONS = merged("sections");
const RANKS = merged("ranks");
const CAUSES = merged("causes");
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
const num = (s, max = 1e7) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n < max ? n : 0;
};

// "Sentinel Hill, Westfall" or "Westfall".
function place(text) {
  const t = tidy(text);
  const i = t.lastIndexOf(", ");
  return i < 0 ? { zone: t } : { sub: t.slice(0, i), zone: t.slice(i + 2) };
}
const at = text => text ? place(text) : {};

// An entry line, "- Oct 01 14:23  The Deadmines · dungeon" (two spaces after the time; "-   text" without one), as
// its " · " parts without the group part, whether it had one, and its time.
function entry(line, T) {
  const m = /^-\s(.*?)\s\s(.*)$/s.exec(line);
  // A paste that squeezed the double space: take what looks like the time ("Oct 01 14:23") off the front.
  const squeezed = m ? null : /^(\S{2,6} \d{1,2} \d{1,2}:\d{2}) /.exec(line.replace(/^-\s*/, ""));
  const text = m ? m[2] : line.replace(/^-\s*/, "").slice(squeezed ? squeezed[0].length : 0);
  const parts = text.split(" · ").map(s => s.trim()).filter(Boolean);
  const grouped = parts.length > 1 && Boolean(matchIn(T, "with", parts[parts.length - 1]));
  if (grouped) parts.pop();
  return { parts, grouped, time: m ? m[1].trim() : squeezed?.[1] };
}

// Reads a pasted record. Returns the profile's facts (plain JSON), or throws RecordError with a code: "empty",
// "too-big" or "not-a-record". now: when it's read (the record's times have no year).
export function parseRecord(input, now = new Date()) {
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
    profs: [], rep: [], deaths: [], books: [], shots: 0, fought: [], grouped: 0, timeline: [],
    stats: null,   // the journey in numbers (statsOf), when the record has them (add-ons from LOR-246 on)
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

  // The sections: a title line, then its "- " entries. "Most fought" is one comma-separated line, and so are the
  // journey stats' walk by land and foes by kind.
  let section = null, statAt = 0, known = false;
  const when = new Map();   // entry -> its time in minutes (null: the line had none we could read)
  const pairs = line => Array.from(line.matchAll(/(?:^|, )([^,]+?): (\d+)(?=, |$)/g), m => [tidy(m[1]), m[2]]);
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { section = null; continue; }
    if (CUT.has(line)) { data.cut = true; continue; }
    if (SECTIONS.has(line)) { section = SECTIONS.get(line); known = true; statAt = 0; continue; }
    if (FOUGHT.has(line)) { section = "fought"; known = true; continue; }
    // The journey stats come first: a title this file doesn't know yet, before any it does, over "- Name: 12" lines.
    if (!section && !known && !line.startsWith("-") && STAT_LINE.test(lines[i + 1] || "")) {
      section = "stats"; known = true; statAt = 0; continue;
    }
    if (section === "fought") {
      for (const [name, n] of pairs(line)) data.fought.push({ name, n: num(n) });
      continue;
    }
    if (section === "stats") {
      if (line.startsWith("-")) stat(line, data, T, statAt++);
      continue;
    }
    if (Object.hasOwn(STAT_LISTS, section)) {
      const s = data.stats ||= statsOf();
      const item = STAT_LISTS[section] || ((name, n) => ({ name, n: num(n) }));
      for (const [name, n] of pairs(line)) if (s[section].length < STAT_CAP[section]) s[section].push(item(name, n));
      continue;
    }
    if (!section || !line.startsWith("-")) continue;
    const { parts, grouped, time } = entry(line, T);
    if (!parts.length) continue;
    if (grouped) data.grouped++;
    const e = read(section, parts, data, T);
    if (e) when.set(e, stamp(time, now));
  }

  // A killer the record doesn't also list as a foe (or among the creatures that slew them, which the add-on keeps
  // without players) is dropped: "slain by" could name another player.
  const foes = new Set([...data.fought, ...data.kills, ...data.bosses, ...(data.stats?.killers || [])].map(f => f.name));
  for (const d of data.deaths) if (d.by && !foes.has(d.by)) delete d.by;
  for (const [k, n] of Object.entries(CAP)) if (data[k].length > n) data[k] = data[k].slice(-n);
  data.timeline = timeline(data, when);
  if (!data.level) data.level = data.levels.reduce((a, l) => Math.max(a, l.level), 0) || null;
  data.totals ||= { quests: data.quests.length, places: data.places.length, people: data.people.length,
                    foes: data.fought.length, bosses: data.bosses.length };
  return data;
}

// The journey in numbers (LOR-246), as a profile keeps them: yards walked, foes slain (and of them elites and rares),
// deaths, hours recorded (played with the add-on's journey on) and played (the game's /played, when the player has
// asked it), then yards walked per land and kills per creature type, the biggest first. null in a record without them.
// LOR-262 adds yards ridden, swum and flown, flights, places flown to, boat trips, fish, days played, the longest run
// of days in a row, words of the lore of their journey and narrations heard (0 when the record doesn't say), and the
// lists of what slew them, their patrons, inns, flights by destination and minutes per land.
const statsOf = () => ({ yards: 0, slain: 0, elites: 0, rares: 0, deaths: 0, recorded: 0, played: null, walk: [], kinds: [],
  ride: 0, swim: 0, flown: 0, flights: 0, flownTo: 0, boats: 0, fish: 0, days: 0, best: 0, words: 0, heard: 0,
  time: [], killers: [], patrons: [], inns: [], destinations: [] });

// One "- Yards walked: 41203" line of the journey stats, the at-th: by its words in the record's language or English,
// else by its place.
function stat(line, data, T, at) {
  const text = line.replace(/^-\s*/, "");
  let key = null, value = null;
  for (const C of T.code === "en" ? [T] : [T, COMPILED.en]) {
    const hit = C.stats.find(([, c]) => match(c, text));
    if (hit) { key = hit[0]; value = match(hit[1], text)[0]; break; }
  }
  if (!key) {
    const m = /:\s*([\d.,]+)$/.exec(text);
    key = m ? STAT_ORDER[at] ?? null : null;
    value = m && m[1];
  }
  if (!key) return;
  const s = data.stats ||= statsOf();
  if (STAT_HOURS.has(key)) {
    const h = parseFloat(String(value).replace(",", "."));
    s[key] = Number.isFinite(h) && h >= 0 && h < 1e5 ? Math.round(h * 10) / 10 : (key === "played" ? null : 0);
  } else {
    s[key] = num(String(value).replace(/[.,]/g, ""), key === "yards" ? 1e9 : 1e7);
  }
}

// The kept moments in time order, as [section, index, day ("2026-10-01", or null when the line had no time)]. Moments
// of the same minute go in TIMELINE's order, then the record's. A line without a time sorts first.
function timeline(data, when) {
  const out = [];
  TIMELINE.forEach((k, s) => data[k].forEach((e, i) => {
    const t = when.get(e) ?? null;
    out.push({ t, s, i, k });
  }));
  out.sort((a, b) => (a.t ?? -Infinity) - (b.t ?? -Infinity) || a.s - b.s || a.i - b.i);
  return out.map(({ t, i, k }) => [k, i, t === null ? null : new Date(t * 60000).toISOString().slice(0, 10)]);
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

// ---- The companion's journey data (LOR-248, the companion scope's item 5) ----
//
// Next to the record, the companion app sends `journey: {v: 1, tz, moments: [{t, k, ...}]}`, built from its journal on
// the player's PC (every event, not the add-on's trimmed copy): when each moment happened (t, seconds), what it was
// (k: Journey.lua's event kinds) and its game IDs, so the page can follow a quest from where it was taken to where it
// was turned in and draw the road between lands. Pastes stay text only. tz: the PC's offset from UTC in minutes, only
// so a moment shows on the player's own day. Like the record, it's untrusted: only these kinds and fields are kept,
// names are tidied and capped, there's no party (other players), and a killer is kept only when the journey or the
// record lists it as a foe.

export const JOURNEY_V = 1;
export const MAX_MOMENTS = 2000;
const JOURNEY_KINDS = new Set(["zone", "qa", "qt", "npc", "boss", "kill", "lvl", "death", "book", "loot", "mount", "rep", "shot"]);
const HOW = new Set(["walk", "flight", "hearth", "boat", "corpse", "portal", "instance"]);
const NOTABLE = new Set(["elite", "rare", "rareelite", "worldboss"]);
const EARLIEST = Date.UTC(2004, 10, 23) / 1000;   // nothing in WoW happened before launch day
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// The journey as stored ({v, tz, moments} in time order), or null when there's none worth keeping. data: the record's
// facts, for which killers are foes.
export function readJourney(input, data = null, now = new Date()) {
  if (!input || typeof input !== "object" || input.v !== JOURNEY_V || !Array.isArray(input.moments)) return null;
  const latest = (now.getTime() + AHEAD) / 1000;
  const out = [];
  for (const m of input.moments.slice(-MAX_MOMENTS)) {
    if (!m || typeof m !== "object" || !JOURNEY_KINDS.has(m.k)) continue;
    const t = int(m.t, EARLIEST, latest);
    if (t === null) continue;
    const e = { t, k: m.k };
    // A history projection retains the offset captured with each event; older snapshots use the envelope offset.
    const tz = int(m.tz, -840, 840);
    if (tz !== null) e.tz = tz;
    for (const key of ["z", "s", "n"]) {
      const v = typeof m[key] === "string" ? tidy(m[key]) : "";
      if (v) e[key] = v;
    }
    switch (m.k) {
      case "shot":
        if (!(typeof m.character === "string" && /^[a-f0-9]{64}$/.test(m.character))) continue;
        e.character = m.character;
        if (int(m.lv, 1, 100)) e.lv = m.lv;
        break;
      case "zone":
        if (!e.z || !(m.new || m.inst)) continue;
        if (m.new) e.new = 1;
        if (m.inst) e.inst = 1;
        if (HOW.has(m.how)) e.how = m.how;
        break;
      case "qa": case "qt":
        if (!(e.id = int(m.id, 1, 9999999))) continue;
        break;
      case "kill":
        if (!e.n || !NOTABLE.has(m.cls)) continue;
        e.cls = m.cls;
        break;
      case "lvl":
        if (!(e.lv = int(m.lv, 2, 100))) continue;
        break;
      case "death":
        if (typeof m.by === "string" && tidy(m.by)) e.by = tidy(m.by);
        break;
      case "loot": {
        if (!e.n) continue;
        const ql = int(m.ql, 0, 7), qid = int(m.qid, 1, 9999999);
        if (ql !== null) e.ql = ql;
        if (qid) e.qid = qid;
        break;
      }
      case "rep":
        if (!e.n || !(e.st = int(m.st, 1, 8))) continue;
        break;
      default:   // npc, boss, book, mount: a name
        if (!e.n) continue;
    }
    out.push(e);
  }
  // "Slain by" could name another player: kept only for a foe the journey or the record lists.
  const foes = new Set([...out.filter(e => e.k === "kill" || e.k === "boss").map(e => e.n),
    ...[...(data?.fought || []), ...(data?.kills || []), ...(data?.bosses || [])].map(f => f.name)]);
  for (const e of out) if (e.by && !foes.has(e.by)) delete e.by;
  if (!out.length) return null;
  out.sort((a, b) => a.t - b.t);
  return { v: JOURNEY_V, tz: int(input.tz, -840, 840) ?? 0, moments: out };
}

// One entry into its section's list. Returns the entry a moment section added (for its time), else nothing.
function read(section, parts, data, T) {
  const [first, ...rest] = parts;
  const name = tidy(first);
  const add = e => { data[section].push(e); return e; };
  switch (section) {
    case "places": return add({ ...place(first), ...(rest.some(p => DUNGEON.has(p)) ? { dungeon: true } : {}) });
    case "quests": return add({ title: name, ...at(rest[0]) });
    case "people": return add({ name, ...at(rest[0]) });
    case "bosses": return add({ name, ...at(rest[0]) });
    case "kills": {
      const rank = RANKS.get(rest[0]);
      return add({ name, rank: rank || null, ...at(rank ? rest[1] : rest[0]) });
    }
    case "loot": {
      // The item, its quality, "reward for <quest>" (or "Quest reward"), then the place; each after the item optional.
      let j = 0;
      const quality = QUALITY.get(rest[j]);
      if (quality !== undefined) j++;
      const rewardFor = rest[j] !== undefined ? matchIn(T, "rewardFor", rest[j]) : null;
      const reward = rewardFor !== null || (rest[j] !== undefined && QUEST_REWARD.has(rest[j]));
      if (reward) j++;
      return add({ name, quality: quality ?? null, ...(reward ? { reward: true } : {}),
                   ...(rewardFor && tidy(rewardFor[0]) ? { quest: tidy(rewardFor[0]) } : {}), ...at(rest[j]) });
    }
    case "levels": {
      const m = matchIn(T, "reached", first);
      return m ? add({ level: num(m[0]), ...at(rest[0]) }) : undefined;
    }
    case "spells": data.spells.push({ name }); return;
    case "mounts": return add({ name, ...at(rest[0]) });
    case "profs": {
      const m = /^(.*\S)\s+(\d+)$/.exec(first);
      if (!m) return;
      const prof = tidy(m[1]), rank = num(m[2]);
      const had = data.profs.find(p => p.name === prof);
      if (had) had.rank = Math.max(had.rank, rank); else data.profs.push({ name: prof, rank });
      return;
    }
    case "rep": {
      const m = matchIn(T, "rep", first);
      if (!m) return;
      const faction = tidy(m[1]);
      data.rep = data.rep.filter(r => r.faction !== faction);   // the latest standing wins
      return add({ faction, standing: tidy(m[0]), ...at(rest[0]) });
    }
    case "deaths": {
      // Where (or "Died" when the game didn't say), then "slain by X" when it did, or how (drowned, LOR-262).
      const slain = parts.map(p => matchIn(T, "slain", p)).find(Boolean);
      const cause = parts.map(p => CAUSES.get(p)).find(Boolean);
      const where = !DIED.has(first) && !matchIn(T, "slain", first);
      return add({ ...(where ? place(first) : {}), ...(slain ? { by: tidy(slain[0]) } : {}), ...(cause ? { cause } : {}) });
    }
    case "books": return add({ title: tidy(first.replace(/^"(.*)"$/s, "$1")), ...at(rest[0]) });
    case "shots": data.shots++; return;
  }
}
