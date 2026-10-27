// The lore page's own words in each language the translated pages come in (LOR-809, pipeline/lore/site_i18n.py LANGS):
// headings, labels and the download box around the story, which is the translation's. The add-on's own words where it
// has them (data/i18n/<locale>/ui.json: "Stufe", "Quests"); anything missing reads in English. Kept outside functions/
// so Pages doesn't route it.
const S = {
  de: {
    Zone: "Zone", Capital: "Hauptstadt", Dungeon: "Dungeon", Place: "Ort", Character: "Figur", Boss: "Boss", Quest: "Quest",
    Item: "Gegenstand", Topic: "Thema", Zones: "Zonen", Dungeons: "Dungeons", Places: "Orte", Characters: "Figuren",
    Bosses: "Bosse", Quests: "Quests", Items: "Gegenstände", Topics: "Themen", Level: "Stufe", Levels: "Stufen",
    Sources: "Quellen", "Look it up": "Nachschlagen", "In {n}": "In {n}", "On the same road": "Auf demselben Weg",
    "Hear it as you play": "Hör es beim Spielen", "Get Lore Forever": "Lore Forever holen", "Read in": "Lesen auf",
    "on Wowhead": "auf Wowhead", "on the Warcraft Wiki": "im Warcraft Wiki", "WoW Forever database": "WoW-Forever-Datenbank",
    cta: "Lore Forever erzählt dir die Geschichte jeder Zone, jedes Ortes, jeder Figur und jeder Quest, sobald du sie in " +
      "WoW Forever erreichst, laut vorgelesen.",
  },
  es: {
    Zone: "Zona", Capital: "Capital", Dungeon: "Mazmorra", Place: "Lugar", Character: "Personaje", Boss: "Jefe",
    Quest: "Misión", Item: "Objeto", Topic: "Tema", Zones: "Zonas", Dungeons: "Mazmorras", Places: "Lugares",
    Characters: "Personajes", Bosses: "Jefes", Quests: "Misiones", Items: "Objetos", Topics: "Temas", Level: "Nivel",
    Levels: "Niveles", Sources: "Fuentes", "Look it up": "Consúltalo", "In {n}": "En {n}",
    "On the same road": "En el mismo camino", "Hear it as you play": "Escúchalo mientras juegas",
    "Get Lore Forever": "Consigue Lore Forever", "Read in": "Leer en", "on Wowhead": "en Wowhead",
    "on the Warcraft Wiki": "en la Warcraft Wiki", "WoW Forever database": "base de datos de WoW Forever",
    cta: "Lore Forever te cuenta en voz alta la historia de cada zona, lugar, personaje y misión cuando llegas a ellos en " +
      "WoW Forever.",
  },
  fr: {
    Zone: "Zone", Capital: "Capitale", Dungeon: "Donjon", Place: "Lieu", Character: "Personnage", Boss: "Boss",
    Quest: "Quête", Item: "Objet", Topic: "Sujet", Zones: "Zones", Dungeons: "Donjons", Places: "Lieux",
    Characters: "Personnages", Bosses: "Boss", Quests: "Quêtes", Items: "Objets", Topics: "Sujets", Level: "Niveau",
    Levels: "Niveaux", Sources: "Sources", "Look it up": "En savoir plus", "In {n}": "Dans {n}",
    "On the same road": "Sur la même route", "Hear it as you play": "Écoutez-la en jouant",
    "Get Lore Forever": "Obtenir Lore Forever", "Read in": "Lire en", "on Wowhead": "sur Wowhead",
    "on the Warcraft Wiki": "sur le Warcraft Wiki", "WoW Forever database": "base de données WoW Forever",
    cta: "Lore Forever vous raconte à voix haute l'histoire de chaque zone, lieu, personnage et quête dès que vous les " +
      "atteignez dans WoW Forever.",
  },
  it: {
    Zone: "Zona", Capital: "Capitale", Dungeon: "Spedizione", Place: "Luogo", Character: "Personaggio", Boss: "Boss",
    Quest: "Missione", Item: "Oggetto", Topic: "Argomento", Zones: "Zone", Dungeons: "Spedizioni", Places: "Luoghi",
    Characters: "Personaggi", Bosses: "Boss", Quests: "Missioni", Items: "Oggetti", Topics: "Argomenti", Level: "Livello",
    Levels: "Livelli", Sources: "Fonti", "Look it up": "Approfondisci", "In {n}": "In {n}",
    "On the same road": "Sulla stessa strada", "Hear it as you play": "Ascoltala mentre giochi",
    "Get Lore Forever": "Scarica Lore Forever", "Read in": "Leggi in", "on Wowhead": "su Wowhead",
    "on the Warcraft Wiki": "sulla Warcraft Wiki", "WoW Forever database": "database di WoW Forever",
    cta: "Lore Forever ti racconta ad alta voce la storia di ogni zona, luogo, personaggio e missione appena li raggiungi " +
      "in WoW Forever.",
  },
  "pt-br": {
    Zone: "Zona", Capital: "Capital", Dungeon: "Masmorra", Place: "Local", Character: "Personagem", Boss: "Chefe",
    Quest: "Missão", Item: "Item", Topic: "Tópico", Zones: "Zonas", Dungeons: "Masmorras", Places: "Locais",
    Characters: "Personagens", Bosses: "Chefes", Quests: "Missões", Items: "Itens", Topics: "Tópicos", Level: "Nível",
    Levels: "Níveis", Sources: "Fontes", "Look it up": "Saiba mais", "In {n}": "Em {n}",
    "On the same road": "No mesmo caminho", "Hear it as you play": "Ouça enquanto joga",
    "Get Lore Forever": "Baixe o Lore Forever", "Read in": "Ler em", "on Wowhead": "no Wowhead",
    "on the Warcraft Wiki": "na Warcraft Wiki", "WoW Forever database": "banco de dados do WoW Forever",
    cta: "O Lore Forever conta em voz alta a história de cada zona, local, personagem e missão quando você chega a eles " +
      "em WoW Forever.",
  },
  ru: {
    Zone: "Зона", Capital: "Столица", Dungeon: "Подземелье", Place: "Место", Character: "Персонаж", Boss: "Босс",
    Quest: "Задание", Item: "Предмет", Topic: "Тема", Zones: "Зоны", Dungeons: "Подземелья", Places: "Места",
    Characters: "Персонажи", Bosses: "Боссы", Quests: "Задания", Items: "Предметы", Topics: "Темы", Level: "Уровень",
    Levels: "Уровни", Sources: "Источники", "Look it up": "Узнать больше", "In {n}": "Внутри: {n}",
    "On the same road": "На той же дороге", "Hear it as you play": "Слушайте во время игры",
    "Get Lore Forever": "Скачать Lore Forever", "Read in": "Читать на", "on Wowhead": "на Wowhead",
    "on the Warcraft Wiki": "в Warcraft Wiki", "WoW Forever database": "база данных WoW Forever",
    cta: "Lore Forever вслух рассказывает историю каждой зоны, места, персонажа и задания, когда вы до них добираетесь " +
      "в WoW Forever.",
  },
  uk: {
    Zone: "Зона", Capital: "Столиця", Dungeon: "Підземелля", Place: "Місце", Character: "Персонаж", Boss: "Бос",
    Quest: "Завдання", Item: "Предмет", Topic: "Тема", Zones: "Зони", Dungeons: "Підземелля", Places: "Місця",
    Characters: "Персонажі", Bosses: "Боси", Quests: "Завдання", Items: "Предмети", Topics: "Теми", Level: "Рівень",
    Levels: "Рівні", Sources: "Джерела", "Look it up": "Дізнатися більше", "In {n}": "Усередині: {n}",
    "On the same road": "На тій самій дорозі", "Hear it as you play": "Слухайте під час гри",
    "Get Lore Forever": "Завантажити Lore Forever", "Read in": "Читати мовою", "on Wowhead": "на Wowhead",
    "on the Warcraft Wiki": "у Warcraft Wiki", "WoW Forever database": "база даних WoW Forever",
    cta: "Lore Forever уголос розповідає історію кожної зони, місця, персонажа й завдання, щойно ви до них дістаєтеся " +
      "у WoW Forever.",
  },
  zh: {
    Zone: "区域", Capital: "主城", Dungeon: "地下城", Place: "地点", Character: "人物", Boss: "首领", Quest: "任务",
    Item: "物品", Topic: "主题", Zones: "区域", Dungeons: "地下城", Places: "地点", Characters: "人物", Bosses: "首领",
    Quests: "任务", Items: "物品", Topics: "主题", Level: "等级", Levels: "等级", Sources: "来源", "Look it up": "延伸阅读",
    "In {n}": "{n}中的内容", "On the same road": "同一条路上", "Hear it as you play": "边玩边听",
    "Get Lore Forever": "获取 Lore Forever", "Read in": "阅读语言", "on Wowhead": "（Wowhead）",
    "on the Warcraft Wiki": "（Warcraft Wiki）", "WoW Forever database": "WoW Forever 数据库",
    cta: "当你在 WoW Forever 中抵达每个区域、地点、人物和任务时，Lore Forever 会为你朗读它们的故事。",
  },
};

// The player's words, for the pages that play their own language's narrators (pipeline/lore/site_i18n.py
// native_voices), and the line on a page with no recording in its language.
const PLAYER = {
  de: { Listen: "Anhören", "{n} recordings": "{n} Aufnahmen", Speed: "Tempo", "Playback speed": "Wiedergabetempo",
    "The story": "Die Geschichte", "Quest text": "Questtext", Progress: "Fortschritt", Completion: "Abschluss",
    "Show the words": "Text anzeigen", "Male narrator": "Erzähler", "Female narrator": "Erzählerin",
    "Hear this one in game:": "Hör sie im Spiel:", "get Lore Forever": "Lore Forever holen",
    norec: "Davon gibt es noch keine deutsche Aufnahme: Lies es hier." },
  es: { Listen: "Escuchar", "{n} recordings": "{n} grabaciones", Speed: "Velocidad", "Playback speed": "Velocidad de reproducción",
    "The story": "La historia", "Quest text": "Texto de la misión", Progress: "Progreso", Completion: "Finalización",
    "Show the words": "Mostrar el texto", "Male narrator": "Narrador", "Female narrator": "Narradora",
    "Hear this one in game:": "Escúchalo en el juego:", "get Lore Forever": "consigue Lore Forever",
    norec: "Todavía no hay grabación en español de esto: léelo aquí." },
  fr: { Listen: "Écouter", "{n} recordings": "{n} enregistrements", Speed: "Vitesse", "Playback speed": "Vitesse de lecture",
    "The story": "L'histoire", "Quest text": "Texte de la quête", Progress: "Progression", Completion: "Achèvement",
    "Show the words": "Afficher le texte", "Male narrator": "Narrateur", "Female narrator": "Narratrice",
    "Hear this one in game:": "Écoutez-le en jeu :", "get Lore Forever": "obtenez Lore Forever",
    norec: "Pas encore d'enregistrement en français : lisez-le ici." },
  it: { Listen: "Ascolta", "{n} recordings": "{n} registrazioni", Speed: "Velocità", "Playback speed": "Velocità di riproduzione",
    "The story": "La storia", "Quest text": "Testo della missione", Progress: "Avanzamento", Completion: "Completamento",
    "Show the words": "Mostra il testo", "Male narrator": "Narratore", "Female narrator": "Narratrice",
    "Hear this one in game:": "Ascoltalo in gioco:", "get Lore Forever": "scarica Lore Forever",
    norec: "Ancora nessuna registrazione in italiano: leggilo qui." },
  "pt-br": { Listen: "Ouvir", "{n} recordings": "{n} gravações", Speed: "Velocidade", "Playback speed": "Velocidade de reprodução",
    "The story": "A história", "Quest text": "Texto da missão", Progress: "Progresso", Completion: "Conclusão",
    "Show the words": "Mostrar o texto", "Male narrator": "Narrador", "Female narrator": "Narradora",
    "Hear this one in game:": "Ouça no jogo:", "get Lore Forever": "baixe o Lore Forever",
    norec: "Ainda não há gravação em português disto: leia aqui." },
  ru: { norec: "Записи на русском пока нет: прочитайте здесь." },
  uk: { norec: "Запису українською ще немає: прочитайте тут." },
  zh: { norec: "暂无中文录音：请在此阅读。" },
};
for (const [lang, words] of Object.entries(PLAYER)) Object.assign(S[lang], words);

const EN = {
  "In {n}": "In {n}", "Read in": "Read in", "on Wowhead": "on Wowhead", "on the Warcraft Wiki": "on the Warcraft Wiki",
  "WoW Forever database": "WoW Forever database", "Hear it as you play": "Hear it as you play",
  "Get Lore Forever": "Get Lore Forever", norec: "No {n} recording of this yet: read it here.",
  cta: "Lore Forever tells you the story of each zone, place, character and quest as you reach it in WoW Forever, read " +
    "aloud, and answers what you wonder about along the way.",
};

// The page's word for s in lang ("en" or a translated page's segment), with {n} filled in.
export function tr(lang, s, n = "") {
  const t = (S[lang] && S[lang][s]) || EN[s] || s;
  return t.replace("{n}", n);
}

// "Levels 10-20" / "Level 11" in the page's language.
export function levelsIn(lang, levels) {
  const m = /^(Levels?) (.+)$/.exec(levels || "");
  return m ? `${tr(lang, m[1])} ${m[2]}` : levels || "";
}
