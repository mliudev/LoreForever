// What WoW Forever changed about classes, talents, systems and the world (Mike, 10/12: "Review all major changes in
// wow forever so we can get accurate answers like talents, classes, legacy points, etc"). Seed facts for
// lib/forever-knowledge.js, each searched on its own, so each names its own subject. Checked against the Forever
// client (build 1.60.1.70338: CharBaseInfo, the Trait trees, SkillLineAbility, AreaTable, Faction, Map, LFGDungeons,
// GlobalStrings) and Blizzard's own articles; never Wowhead itself. The dungeon and library facts at the end are from
// ForeverChanges (foreverchanges.pro: the beta client, Blizzard and players' beta reports; Mike, 10/15: a source for
// what Forever changes), as facts in our words. Not here: anything only the client hints at that Blizzard
// hasn't announced (Gilneas, Manor Mistmantle, Hyjal Crater), Season of Discovery content in the same client, and
// per-rank talent numbers (higher ranks aren't in the client).

const CLIENT = { title: "WoW Forever's own client data, build 1.60.1.70338 (Lore Forever)", url: "" };
const QUESTS = { title: "WoW Forever's own quest text (Lore Forever library)", url: "https://loreforeverwow.com/lore" };
const blizzard = (title, url) => ({ title: `Blizzard: ${title}`, url });
const PRIEST_WARRIOR = blizzard("WoW Forever Class Deep Dives: Priest & Warrior",
  "https://news.blizzard.com/en-us/article/24301514/world-of-warcraft-forever-class-deep-dives-priest-and-warrior");
const HUNTER_DRUID = blizzard("WoW Forever Class Deep Dives: Hunter & Druid",
  "https://news.blizzard.com/en-us/article/24301515/world-of-warcraft-forever-class-deep-dives-hunter-and-druid");
const MAGE_SHAMAN = blizzard("WoW Forever Class Deep Dives: Mage & Shaman",
  "https://news.blizzard.com/en-us/article/24302097/world-of-warcraft-forever-class-deep-dives-mage-and-shaman");
const ROGUE_WARLOCK = blizzard("WoW Forever Class Deep Dives: Rogue & Warlock", "https://worldofwarcraft.blizzard.com/en-us/news/24310968");
const PANEL = blizzard("WoW Forever Deep Dive Panel Recap",
  "https://news.blizzard.com/en-us/article/24303313/world-of-warcraft-forever-deep-dive-panel-recap");
const LEGACY = blizzard("The Legacy System in WoW Forever", "https://worldofwarcraft.blizzard.com/en-us/news/24307383");
const RULESETS = blizzard("WoW Forever rulesets", "https://news.blizzard.com/en-us/article/24302070");
const NAMES = blizzard("WoW Forever character names", "https://news.blizzard.com/en-us/article/24304161");
const PVP = blizzard("WoW Forever PvP", "https://worldofwarcraft.blizzard.com/en-us/news/24303316");
const DARKSPEAR = blizzard("Darkspear Islands battleground", "https://worldofwarcraft.blizzard.com/en-us/news/24307308");
const ROADMAP = { title: "Warcraft Tavern: WoW Forever roadmap, beta and launch dates, raids",
  url: "https://www.warcrafttavern.com/forever/news/world-of-warcraft-forever-roadmap-beta-launch-date-raids/" };
const DUNGEONS = { title: "Warcraft Tavern: all new dungeons and raids in WoW Forever",
  url: "https://www.warcrafttavern.com/forever/news/all-new-dungeons-raids-in-wow-forever-revealed-at-blizzcon/" };
const ZONES = { title: "Warcraft Tavern: all new zones in WoW Forever",
  url: "https://www.warcrafttavern.com/forever/news/all-new-zones-areas-in-wow-forever-revealed-at-blizzcon/" };
const HUMAN_RACIALS = { title: "Warcraft Tavern: human racial abilities in WoW Forever",
  url: "https://www.warcrafttavern.com/forever/guides/human-racials/" };
const KIRIN_TOR = { title: "Icy Veins: Horde players aren't welcome in Dalaran in WoW Forever",
  url: "https://www.icy-veins.com/wow-forever/news/wow-forever-confirms-horde-players-arent-welcome-in-dalaran/" };
const wiki = page => ({ title: `Warcraft Wiki: ${page} (Forever)`, url: `https://warcraft.wiki.gg/wiki/${page.replace(/ /g, "_")}` });
const changes = (page, path) => ({ title: `ForeverChanges: ${page}`, url: `https://foreverchanges.pro${path}` });
const FAVOR = changes("Merchant's Favor", "/merchants-favor");
const VMANGOS = { title: "The original game's world database (VMaNGOS, patch 1.12)", url: "https://github.com/vmangos/core" };
const TOWN_DATA = { title: "WoW Forever's own client data: who stands where in its towns (Lore Forever)", url: "" };
const RIDING_GUIDE = { title: "Warcraft Tavern: riding skill and trainers in WoW Forever",
  url: "https://www.warcrafttavern.com/forever/guides/riding/" };

// Forever's riding, for the facts below and Willo's goals (lib/willo-goals.js, LOR-665), so both say the same numbers.
// By riding skill: the level it's trained at, the trainer's price in gold (Warcraft Tavern's guide; Blizzard's panel:
// learning it gives your first mount) and what a mount from your people's vendor costs (Forever's client, ItemSparse
// BuyPrice of the level 40 and 60 racial mounts: 20 and 200 gold). honoredOff: off both once you're Honored with your
// home city (the guide).
export const RIDING = {
  75: { name: "Riding", level: 40, gold: 100, mounts: 20, speed: 60 },
  150: { name: "Journeyman riding", level: 60, gold: 1000, mounts: 200, speed: 100 },
};
export const RIDING_HONORED_OFF = 0.1;

// A profession's ranks: the skill each takes it to, and the skill and level a trainer teaches it from. Forever keeps the
// original professions (Blizzard's panel); its client holds the rank spells (SkillLineAbility: Apprentice, Journeyman,
// Expert, Artisan for each) but not who teaches them when, so these are the original game's (VMaNGOS npc_trainer, the
// same for every crafting and gathering profession). Without them she said "Expert at 150" and "Artisan at 225" (the
// blind check, 10/18).
export const PROFESSION_RANKS = [
  { name: "Apprentice", cap: 75, from: 0, level: 5 },
  { name: "Journeyman", cap: 150, from: 50, level: 10 },
  { name: "Expert", cap: 225, from: 125, level: 20 },
  { name: "Artisan", cap: 300, from: 200, level: 35 },
];
// Who teaches Artisan, by profession and faction: the trainers Forever's town data titles "Artisan …" (lib/forever-
// services.js). The gathering professions' Artisan teachers aren't in it, nor the secondary ones' (a quest).
export const ARTISAN_TRAINERS = {
  Alchemy: { Alliance: "Ainethil on Darnassus's Craftsmen's Terrace", Horde: "Doctor Herbert Halsey in the Undercity's Apothecarium" },
  Blacksmithing: { Alliance: "Bengus Deepforge at Ironforge's Great Forge", Horde: "Saru Steelfury in Orgrimmar's Valley of Honor" },
  Engineering: { Alliance: "Springspindle Fizzlegear in Ironforge's Tinker Town", Horde: "Roxxik in Orgrimmar's Valley of Honor" },
  Leatherworking: { Alliance: "Telonis on Darnassus's Craftsmen's Terrace", Horde: "Una in Thunder Bluff" },
  Enchanting: { Alliance: "Kitta Firewind at the Tower of Azora in Elwynn Forest", Horde: "Hgarth at Sun Rock Retreat in Stonetalon Mountains" },
  Tailoring: { Alliance: "Georgio Bolero in Stormwind's Mage Quarter", Horde: "Josef Gregorian in the Undercity's Magic Quarter" },
};
// Each people's riding trainer (Forever's town data, lib/forever-services.js: its client's creatures where they stand)
// and home city, by the add-on's race token, and the mounts its vendor sells (the client's vendor lists, as the item
// facts give them; the answer log 10/18: a gnome at Steelgrill's Depot was told mechanostriders aren't mounts). The skyborne's trainer isn't known yet. Willo's goals (lib/willo-goals.js)
// and the riding-trainers fact say the same: without the fact in play, she sent a human to "the riding trainer in
// Stormwind's Cathedral District" (the blind check, 10/18).
export const RIDING_PEOPLES = {
  Human: { people: "Humans", side: "Alliance", city: "Stormwind", trainer: "Randal Hunter at Eastvale Logging Camp in Elwynn Forest",
    mounts: "horses", vendor: "Katie Hunter at Eastvale Logging Camp in Elwynn Forest" },
  Dwarf: { people: "Dwarves", side: "Alliance", city: "Ironforge", trainer: "Ultham Ironhorn at Amberstill Ranch in Dun Morogh",
    mounts: "rams", vendor: "Veron Amberstill at Amberstill Ranch in Dun Morogh" },
  Gnome: { people: "Gnomes", side: "Alliance", city: "Gnomeregan Exiles", trainer: "Binjy Featherwhistle at Steelgrill's Depot in Dun Morogh",
    mounts: "mechanostriders", vendor: "Milli Featherwhistle at Steelgrill's Depot in Dun Morogh" },
  NightElf: { people: "Night elves", side: "Alliance", city: "Darnassus", trainer: "Jartsam in Darnassus",
    mounts: "frostsabers", vendor: "Lelanai in Darnassus's Cenarion Enclave" },
  Orc: { people: "Orcs", side: "Horde", city: "Orgrimmar", trainer: "Kildar in Orgrimmar's Valley of Honor",
    mounts: "wolves", vendor: "Ogunaro Wolfrunner in Orgrimmar's Valley of Honor" },
  Troll: { people: "Trolls", side: "Horde", city: "Darkspear Trolls", trainer: "Xar'Ti at Sen'jin Village in Durotar",
    mounts: "raptors", vendor: "Zjolnir at Sen'jin Village in Durotar" },
  Tauren: { people: "Tauren", side: "Horde", city: "Thunder Bluff", trainer: "Kar Stormsinger at Bloodhoof Village in Mulgore",
    mounts: "kodos", vendor: "Harb Clawhoof at Bloodhoof Village in Mulgore" },
  Scourge: { people: "The Forsaken", side: "Horde", city: "Undercity", trainer: "Velma Warnam in Brill, Tirisfal Glades",
    mounts: "skeletal horses", vendor: "Zachariah Post in Brill, Tirisfal Glades" },
};
// A race by the add-on's token or its English name ("Night Elf", "Undead"), to its RIDING_PEOPLES entry, or null.
const RACE_NAMES = { "night elf": "NightElf", nightelf: "NightElf", undead: "Scourge", forsaken: "Scourge",
  scourge: "Scourge", human: "Human", dwarf: "Dwarf", gnome: "Gnome", orc: "Orc", troll: "Troll", tauren: "Tauren" };
export const ridingPeople = race =>
  RIDING_PEOPLES[RACE_NAMES[String(race || "").toLowerCase().replace(/\s+/g, " ").trim()] || ""] || null;
// The riding-trainers fact for a player whose people is known names only theirs: given all eight, she mixed them up
// (the PM's live runs, 10/18: a human was sent to Unger Statforth, to Bralla Cloudwing and to Katie Hunter "at the
// Stormwind stables", who sells horses at Eastvale).
export const ridingTrainerFor = race => {
  const own = ridingPeople(race);
  return own && `In WoW Forever each people learns to ride from its own riding trainer. ${own.people} learn from ` +
    `${own.trainer}.${own.side === "Alliance" ? " There's no riding trainer inside Stormwind." : ""}`;
};
// The mounts fact for a player whose people is known: theirs and where they're sold.
export const ridingMountsFor = race => {
  const own = ridingPeople(race);
  return own && `In WoW Forever learning riding gives you your first mount, so you don't buy one. ${own.people} ride ` +
    `${own.mounts}: ${own.vendor} sells more for ${RIDING[75].mounts} gold each at level ${RIDING[75].level}, and swift ` +
    `ones for ${RIDING[150].mounts} gold at level ${RIDING[150].level}.`;
};

export const GAME_FACTS = [
  // Talents and the Legacy system
  { id: "talents-system", title: "Talents in WoW Forever", source: PRIEST_WARRIOR,
    text: "WoW Forever keeps three talent trees per class and 51 points, one a level from 10. Each tree has big " +
      "milestone talents at 11, 16, 21 and 31 points; the 16-point one is new. Talents (and Legacy talents) are reset " +
      "only at a class trainer in a major city, and Dual Specialization unlocks at level 40." },
  { id: "legacy-system", title: "Legacy points and the Legacy system", source: LEGACY,
    text: "WoW Forever's Legacy system is account-wide: each Legacy Challenge you complete gives one Legacy Point. It " +
      "unlocks with your first point, usually when your first character reaches level 25 (or 150 in a crafting " +
      "profession, or exploring the whole map). Each character spends up to 16 points in three Legacy trees: " +
      "Professions, Adventure and Resourcefulness. Hardcore, once it arrives, keeps separate Legacy progress." },
  { id: "legacy-challenges", title: "Legacy Challenges", source: LEGACY,
    text: "WoW Forever has 65 Legacy Challenges at launch, one Legacy Point each, such as reaching levels 25, 45 and 60 " +
      "on each class, 150, 225 and 300 in crafting professions, defeating the final boss of every dungeon for levels " +
      "15 to 25, 26 to 45 and 46 to 60, Hyjal Summit, the Barrow Deeps and Onyxia, PvP ranks, and exploring Azeroth." },
  { id: "legacy-perks", title: "What Legacy points are spent on", source: LEGACY,
    text: "In WoW Forever you spend Legacy Points on Legacy talents, perks in three trees: Professions (such as " +
      "Working Overtime, more skill-ups), Adventure (such as Well Rested, a bigger rested bonus, and Frequent Flier, " +
      "cheaper and faster flights) and Resourcefulness (such as The Quick and the Dead, a faster corpse run)." },
  { id: "legacy-rewards", title: "Legacy rewards", source: LEGACY,
    text: "WoW Forever's Legacy rewards aren't bought: as your account earns more Legacy Points in total, it unlocks " +
      "cosmetics, a Replica Ironforge Air Rifle, a Spectral Bear Cub pet, a Spectral Bear Tabard and the Reins of the " +
      "Spectral Bear mount." },
  { id: "talents-warrior", title: "Warrior talents in WoW Forever", source: CLIENT,
    text: "WoW Forever warrior talents: Arms gets Spearing Strike (16 points), Bloodthrill and Weaponmaster, which " +
      "replaces the weapon specializations; Fury gets Raging Blows (16), Furious Precision, Lingering Rage and Gore " +
      "Drinker; Protection gets Vanguard (16, Charge in Defensive Stance), Master of Defense, Focused Rage and Bastion. " +
      "Mortal Strike, Bloodthirst and Shield Slam stay at 31." },
  { id: "abilities-warrior", title: "Warrior abilities in WoW Forever", source: PRIEST_WARRIOR,
    text: "WoW Forever warriors learn Tactical Mastery at level 14 (keep 10 Rage when changing stances) and Victory " +
      "Rush at level 20. Recklessness, Retaliation and Shield Wall no longer share a cooldown, and Thunder Clap works " +
      "in Defensive Stance." },
  // Mike asked this (10/11). The client still lists the stance at 30; only a guide says how it's earned.
  { id: "berserker-stance", title: "Berserker Stance", source: { title: "Method.gg: WoW Forever warrior leveling guide",
    url: "https://www.method.gg/wow-forever/wow-forever-warrior-leveling-guide-and-talents" },
    text: "WoW Forever warriors still get Berserker Stance at level 30. Guides say it still comes from the original " +
      "game's quest on Fray Island in the Barrens (The Islander, then The Affray with Klannoc Macleod), but Blizzard " +
      "hasn't confirmed it, so a warrior trainer can say for sure." },
  { id: "talents-priest", title: "Priest talents in WoW Forever", source: PRIEST_WARRIOR,
    text: "WoW Forever priest talents: Discipline gets Soul Warding (16 points), Penance (21) and Divine Aegis; Holy " +
      "gets Binding Heal (16) and Prayer of Mending (31) and loses Lightwell; Shadow gets Improved Mind Flay, " +
      "Devouring Contagion and Early Demise, with Vampiric Embrace at 16." },
  { id: "abilities-priest", title: "Priest abilities in WoW Forever", source: PRIEST_WARRIOR,
    text: "In WoW Forever every priest, whatever the race, learns Fear Ward and Devouring Plague at level 20, Divine " +
      "Spirit at 30 and Shadow Word: Death at 32. Racial priest spells: humans Divine Grace and Feedback, dwarves " +
      "Chastise and Desperate Prayer, night elves Starshards and Elune's Grace, gnomes Confounding Flash and " +
      "Contingency Plan, undead Touch of Weakness and Dark Sacrifice, trolls Hex of Weakness and Shadowguard." },
  { id: "abilities-paladin", title: "Paladin abilities and talents in WoW Forever", source: PANEL,
    text: "WoW Forever paladins learn Holy Strike at level 6, Seal of Fury (for tanking) at 10, and Consecration and " +
      "Blessing of Kings at 20 from the trainer; Judgement no longer uses up the Seal. Talents: Holy Shock (21) and " +
      "Light's Vigil (31) in Holy, Templar's Bulwark (21) in Protection, Twist of Light (31) in Retribution." },
  { id: "abilities-hunter", title: "Hunter abilities and talents in WoW Forever", source: HUNTER_DRUID,
    text: "WoW Forever hunters learn Aimed Shot at level 20 from the trainer and can lay traps in combat; pets scale " +
      "with the hunter, and foxes are a new pet family. Talents include Summon Hawk (Beast Mastery, 16), Lone Wolf, " +
      "Trueshot Aura (moved up from 31 points) and Sniper Shot (Marksmanship, 31), and Lacerating Strikes (Survival, " +
      "31); Wyvern Sting is gone." },
  { id: "abilities-druid", title: "Druid abilities and talents in WoW Forever", source: HUNTER_DRUID,
    text: "WoW Forever druids learn Nature's Grasp at 10, Revive (an out-of-combat resurrection) at 12, Omen of " +
      "Clarity at 20 and Lacerate at 42; Tiger's Fury is gone. Talents: Insect Swarm at 16 and Eclipse (Balance), " +
      "Shifting Power, Primal Bite (16) and Berserk (Feral, 31), Swiftmend at 16 and Wild Growth (Restoration, 31)." },
  { id: "quest-druid-cat-form", title: "How druids get Cat Form", zone: "Moonglade", source: wiki("To Darnassus"),
    text: "In WoW Forever druids earn Cat Form with a level 20 class quest: a trial of the Great Cat Spirit with " +
      "Dendrite Starblaze in Moonglade, ending with Mathrengyl Bearwalker in Darnassus or Turak Runetotem in Thunder " +
      "Bluff, which teaches Cat Form, Claw, Prowl and Rip." },
  { id: "abilities-rogue", title: "Rogue changes in WoW Forever", source: ROGUE_WARLOCK,
    text: "WoW Forever rogues can use one-handed axes, Sap no longer breaks Stealth, and poisons stack with " +
      "sharpening stones. Talents include Mutilate (Assassination, 21) and Venom (31), Flawless Execution (Combat, " +
      "16) and Hack and Slash, and Thousand Cuts (Subtlety, 31)." },
  { id: "abilities-warlock", title: "Warlock changes in WoW Forever", source: ROGUE_WARLOCK,
    text: "In WoW Forever Curse of Agony and Curse of Doom are Banes (Bane of Agony, Bane of Doom; one Bane per " +
      "warlock on a target), Curse of Shadows is gone, Firestone and Spellstone are weapon imbues, and demons scale " +
      "with the warlock. Talents include Conflagrate at 16, Bane of Havoc (21), Wrack (Affliction, 31), Demonic Pact " +
      "(Demonology, 31) and Incinerate (Destruction, 31)." },
  { id: "abilities-mage", title: "Mage changes in WoW Forever", source: MAGE_SHAMAN,
    text: "WoW Forever mages learn Frostfire Bolt at level 40. Arcane Blast and Ice Lance are 11-point talents, " +
      "Missile Barrage and Ice Block are 16-point talents, and Cold Snap is Frost's 21-point talent. Mages also have " +
      "Comprehension, a mage-only skill for deciphering scrolls." },
  { id: "abilities-shaman", title: "Shaman changes in WoW Forever", source: MAGE_SHAMAN,
    text: "WoW Forever shamans get Call of the Elements and Totemic Recall at level 20 and more one-cast totem sets " +
      "at 30 and 40; buff totems last 5 minutes, Windfury and Flametongue Totems buff the party, and Fire Nova is a " +
      "spell. Elemental Mastery is gone; Lava Burst, Rage of the Farseer and Riptide are the 31-point talents, and " +
      "Maelstrom Weapon is a talent." },
  // LOR-627: "a shaman tank build for WoW Forever?" got "shamans have no tanking specialization" from the original game.
  { id: "tank-shaman", title: "Shaman tanking in WoW Forever", source: MAGE_SHAMAN,
    text: "WoW Forever Enhancement shamans can tank small groups: the 21-point Enhancement talent Spirit Weapons raises " +
      "their threat while Rockbiter Weapon is on (and lowers it without Rockbiter), and Improved Stormstrike can reset " +
      "Stormstrike's cooldown when they dodge or parry. They tank with a shield and a one-handed weapon, as a " +
      "temporary tank for small groups and dungeons, not a raid's main tank." },
  // Races
  { id: "racials-alliance", title: "Alliance racials in WoW Forever", source: CLIENT,
    text: "WoW Forever gives each race two active and two passive racials. Humans: Will to Survive, Perception, " +
      "Sword Specialization, The Human Spirit; dwarves: Stoneform, Find Treasure, Mace Specialization, Big Game " +
      "Hunter; night elves: Shadowmeld, Elune's Light, Quickness, Wisp Spirit; gnomes: Escape Artist, Eureka!, " +
      "Expansive Mind, Engineering Specialization. Diplomacy, Gun Specialization and resistance racials are gone." },
  // LOR-555: the launch video's first answer made a human warrior "best" for Sword Specialization and "your spirit
  // helps you endure"; Spirit does little for a warrior.
  { id: "racials-human", title: "What human racials do in WoW Forever", source: HUMAN_RACIALS,
    text: "In WoW Forever humans' Will to Survive (active) removes every stun on them, from players and creatures " +
      "alike; Perception (active) reveals stealthed and invisible enemies for a short while, pressed by hand; Sword " +
      "Specialization adds 2% critical strike chance; and The Human Spirit raises Spirit by 5%, which speeds health " +
      "and mana regeneration out of combat: it helps those who cast with mana most, and a warrior, who fights on " +
      "rage, very little." },
  { id: "racials-horde", title: "Horde racials in WoW Forever", source: CLIENT,
    text: "WoW Forever Horde racials: orcs Blood Fury, Shatter Curse, Hardiness, Axe Specialization; undead Will of " +
      "the Forsaken, Cannibalize, Touch of the Grave, Underwater Breathing; tauren War Stomp, Cultivation, Endurance, " +
      "Plainsrunning; trolls Berserking, Rapid Regeneration, Regeneration, Beast Slaying. Command, Bow and Throwing " +
      "Specialization and the resistance racials are gone." },
  { id: "racials-skyborne", title: "Skyborne racials", zone: "Zephras Isle", source: CLIENT,
    text: "Skyborne racials in WoW Forever: every skyborne has Walk on Air (a controlled glide down), Elemental Insight " +
      "and Wind Blessed; High Order (Alliance) skyborne also have Read Ley Line, and Windshapers (Horde) Skysight. " +
      "Skyborne ride galestriders." },
  { id: "classes-skyborne-start", title: "Skyborne class trainers", zone: "Zephras Isle", source: wiki("Zephras Isle"),
    text: "Skyborne start in Thendal Grove on Zephras Isle, where the class trainers are Blademaster Ren (warrior), " +
      "Tai'ree Farsight (hunter), Akeri Duskblade (rogue), Xyton Silverwind (druid), Dorii Brightwhisper (mage, High " +
      "Order) and Windshaper Boro (shaman, Windshapers)." },
  { id: "classes-undead-paladin-start", title: "Undead paladins", zone: "Tirisfal Glades", source: QUESTS,
    text: "Undead paladins in WoW Forever start in Deathknell with Aramis Hammerhand, train next with Shari Stilwell " +
      "in Brill, and from about level 8 join the Forsaken paladins of Tyr's Watch at Bandarion Keep, a new keep in " +
      "western Tirisfal Glades." },
  // Systems
  { id: "system-camping", title: "Camping", source: PANEL,
    text: "Camping in WoW Forever: cooks build a Basic Campfire, and each profession adds camp objects, such as a " +
      "Sharpening Wheel, Faction Banner, Incense Candle, Alchemy Lab or Tanning Rack. Sitting nearby gives one-hour buffs that don't stack with matching " +
      "class buffs; camp objects share a cooldown, and campfires must be 100 yards apart." },
  { id: "system-names", title: "First and last names", source: NAMES,
    text: "WoW Forever characters have a first and a second (last) name, and the full name must be unique in the " +
      "region. You can hide the second name in the world, but chat still shows it." },
  { id: "system-rulesets", title: "Rulesets instead of realms", source: RULESETS,
    text: "WoW Forever has no realm list: you pick a ruleset, Normal, PvP or RP at launch, with Hardcore some time " +
      "after launch. You can only group within your ruleset (battlegrounds mix them, except Hardcore), and characters " +
      "can't switch rulesets, except a Hardcore character that dies. On PvP an account plays one faction." },
  { id: "system-collections", title: "Collections and transmog", source: PANEL,
    text: "WoW Forever's appearances, mounts, pets and toys are account-wide. Transmog is optional: you turn it on or " +
      "off at a transmogrifier, and appearances are collected either way." },
  { id: "system-level-cap", title: "Level cap and launch", source: ROADMAP,
    text: "WoW Forever's level cap is 60. It launches on 4 November 2026." },
  { id: "system-riding", title: "Riding and mounts", source: PANEL,
    text: "In WoW Forever, as in The Burning Crusade, learning riding gives you your first mount; Blizzard hasn't " +
      "announced flying." },
  { id: "riding-costs", title: "Riding: level and cost", source: RIDING_GUIDE,
    text: `In WoW Forever you learn riding at level ${RIDING[75].level} from your people's riding trainer for ` +
      `${RIDING[75].gold} gold (${RIDING[75].speed}% faster), and it gives you your first mount. Journeyman riding ` +
      `(${RIDING[150].speed}% faster) is level ${RIDING[150].level} and ${RIDING[150].gold.toLocaleString("en-US")} gold. ` +
      `Once you're Honored with your home city, both cost ${RIDING_HONORED_OFF * 100}% less.` },
  { id: "riding-trainers", title: "Riding trainers", source: CLIENT,
    text: "In WoW Forever each people learns to ride from its own riding trainer: " + Object.values(RIDING_PEOPLES)
      .map(p => `${p.people} from ${p.trainer}`).join("; ") + ". There's no riding trainer inside Stormwind." },
  { id: "profession-ranks", title: "Profession ranks and when to train them", source: VMANGOS,
    text: "In WoW Forever, as in the original game, each profession has four ranks, learned from a trainer: " +
      PROFESSION_RANKS.map(r => `${r.name} takes your skill to ${r.cap}` + (r.from ? `, taught from skill ${r.from} at ` +
        `level ${r.level}` : "")).join("; ") + ". You can learn the next rank as soon as you have its skill and level, " +
      "well before you reach your cap. Cooking, First Aid and Fishing learn Expert from a book and Artisan from a quest." },
  { id: "artisan-trainers", title: "Artisan trainers", source: TOWN_DATA,
    text: "In WoW Forever Artisan (skill 200 to 300) is taught by one trainer per profession for each side: " +
      Object.entries(ARTISAN_TRAINERS).map(([p, t]) => `${p}: ${t.Alliance} (Alliance), ${t.Horde} (Horde)`).join("; ") + "." },
  { id: "riding-mounts", title: "Mounts from your people's vendor", source: CLIENT,
    text: `In WoW Forever learning riding gives you your first mount, so you don't buy one. Only if you want more, your ` +
      `people's mount vendor sells them for ${RIDING[75].mounts} gold each at level ${RIDING[75].level}, and swift ones ` +
      `for ${RIDING[150].mounts} gold at level ${RIDING[150].level}.` },
  { id: "system-professions", title: "Professions in WoW Forever", source: PANEL,
    text: "WoW Forever keeps the original professions with over 600 new recipes; Blizzard hasn't announced " +
      "Jewelcrafting or Inscription. Camping gives each profession camp objects." },
  // What gear carries in this age (the 10/18 cause grid: a hunter told to stack Haste and critical strike rating,
  // from a look-up of today's game). From Forever's own item tables: no item has a rating, and its only "haste" is an
  // attack-speed enchant.
  { id: "system-gear-stats", title: "Gear stats in WoW Forever", source: CLIENT,
    text: "Gear in WoW Forever carries Strength, Agility, Stamina, Intellect and Spirit, armor and resistances, attack " +
      "power, spell damage and healing, and percent chances, such as \"Improves your chance to hit by 1%\" or \"to get " +
      "a critical strike by 1%\". There are no stat ratings, and no haste, mastery or versatility stats." },
  // "What are gems for?" got lore about druids' gems (the 10/18 cause grid). From Forever's item tables.
  { id: "system-gems", title: "Gems in WoW Forever", source: CLIENT,
    text: "Gems in WoW Forever, such as Tigerseye, Malachite, Shadowgem, Moss Agate, Jade and Citrine, are trade goods: " +
      "blacksmiths and engineers use them most, leatherworkers, tailors and enchanters in a few recipes, and they " +
      "sell to vendors or other players. Gear has no gem sockets, and there's no Jewelcrafting." },
  { id: "system-pvp-ranks", title: "PvP ranks", source: PVP,
    text: "WoW Forever's PvP ranks 1 to 14 are earned with Rank Points from battlegrounds, PvP quests and each " +
      "season's weekly tasks, with a weekly cap; rewards include mounts at rank 11 and epic weapons at 14." },
  { id: "bg-darkspear-islands", title: "Darkspear Islands battleground", zone: "Dustwallow Marsh", source: DARKSPEAR,
    text: "Darkspear Islands is WoW Forever's new 15-versus-15 battleground for levels 30 to 60, off the coast of " +
      "Dustwallow Marsh: the Darkspear Raiders (Horde) fight the Theramore Expeditionary Force (Alliance) over four " +
      "capture points and a central flag; the first side to 2,000 points wins." },
  { id: "system-group-finder", title: "Group finder", source: CLIENT,
    text: "WoW Forever has a Classic-style Looking For Group tool for listing yourself or your group; Blizzard " +
      "hasn't announced an automatic dungeon queue." },
  // World
  { id: "zone-riverglades", title: "The Riverglades", zone: "Riverglades", source: wiki("Riverglades"),
    text: "The Riverglades is a new contested WoW Forever zone for about levels 35 to 45 on the Eastern Kingdoms' " +
      "east coast, east of the Badlands and Burning Steppes, north-east of Redridge and north of the Swamp of Sorrows. Its hubs are Farholde " +
      "Keep (Alliance), Rog'mar (Horde) and the goblins' Powderfuse Port." },
  { id: "rep-riverglades", title: "Riverglades reputations", zone: "Riverglades", source: CLIENT,
    text: "The Riverglades' reputations in WoW Forever: the Brotherhood of the Horse (Alliance, at Farholde Keep), the " +
      "Bolder'ok Clan, ogres who left the Twilight's Hammer (Horde), and Powderfuse (both factions)." },
  { id: "zone-shendralas", title: "Shen'dralas", zone: "Shen'dralas", source: wiki("Shen'dralas"),
    text: "Shen'dralas is a new contested WoW Forever zone in Kalimdor, south-east of Desolace between Feralas and " +
      "Mulgore, reached on foot from Desolace through the Valley of Bones. Highborne, Magram centaur and Bristleback " +
      "quilboar live there." },
  { id: "zone-hyjal", title: "Mount Hyjal", zone: "Mount Hyjal", source: ZONES,
    text: "Mount Hyjal is a new high-level WoW Forever zone between Felwood and Winterspring, entered from " +
      "Winterspring through Darkwhisper Gorge (or by flight from Everlook). Its places include Elderwild, the Shrine " +
      "of Aviana and the Summit of Eternity." },
  { id: "rep-hyjal", title: "Mount Hyjal reputations", zone: "Mount Hyjal", source: CLIENT,
    text: "Mount Hyjal's reputations in WoW Forever are the Guardians of Hyjal, a splinter of the Cenarion Circle, and " +
      "the Barkskin Burrow furbolgs, who start Hostile." },
  { id: "zone-zephras", title: "Zephras Isle", zone: "Zephras Isle", source: wiki("Zephras Isle"),
    text: "Zephras Isle, the skyborne starting zone for levels 1 to 12, is a floating island in Skywall, the " +
      "Elemental Plane of Air; Valanaar is its hub. Skyborne reputations are the High Order (Alliance), the " +
      "Windshapers (Horde) and the Nightclaw Druids of its Shadowgale Forest." },
  // The last sentence (10/18, "How do I get Thunderfury?") follows the roadmap, whose three raids leave Molten Core and
  // Blackwing Lair out (foreverchanges.pro names no raids). When Blizzard announces either, change it here.
  { id: "raid-schedule", title: "When WoW Forever's raids open", source: ROADMAP,
    text: "WoW Forever's raids open on 9 December 2026: the Barrow Deeps (10 players), Hyjal Summit (20) and " +
      "Onyxia's Lair (40). The Barrow Deeps are where Illidan Stormrage was imprisoned for ten thousand years, until " +
      "Tyrande freed him in the Third War. Molten Core and Blackwing Lair aren't among the raids announced so far, " +
      "so their gear and the legendary weapons from them, such as Thunderfury and Sulfuras, can't be earned for now." },
  { id: "rep-kirin-tor", title: "Kirin Tor reputation", zone: "Alterac Mountains", source: KIRIN_TOR,
    text: "The Kirin Tor are an Alliance reputation in WoW Forever: Horde characters start Hated and don't get full " +
      "access to Dalaran, though Horde groups can run the City of Dalaran dungeon through their own quests." },
  // LOR-578: Willo, as Marcy Baker, sent Mike to a keep with his sealed goods; she takes them herself (his stream,
  // 10/14: "Set it over by the pile").
  // Each camp is its own fact, so a player near one gets theirs; the crates and what Favor buys are one more.
  { id: "three-corners-commerce", title: "The Azeroth Commerce Authority at Three Corners", zone: "Redridge Mountains",
    source: FAVOR,
    text: "At Three Corners in Redridge Mountains, where the roads from Elwynn Forest, Duskwood and Lakeshire meet " +
      "(10.5, 72.7), the Azeroth Commerce Authority keeps an Alliance supply camp, new in WoW Forever. Marcy Baker, its " +
      "Inventory Intake, takes the filled Waylaid Crates, the sealed goods adventurers bring in, right there (9.5, 71.1), " +
      "for Merchant's Favor. The camp has no mailbox, and Redridge is contested: under PvP rules the Horde can attack there." },
  { id: "durotar-supply-logistics", title: "Durotar Supply and Logistics near the Crossroads", zone: "The Barrens",
    source: FAVOR,
    text: "Just west of the Crossroads in the Barrens, on the road to Stonetalon (49.7, 29.4), Durotar Supply and " +
      "Logistics keeps the Horde's supply camp, new in WoW Forever, its match for the Alliance's Azeroth Commerce " +
      "Authority. Dokimi takes the filled Waylaid Crates there (50.0, 29.2), for Merchant's Favor. Both camps sell the " +
      "same things at the same prices; this one has no mailbox." },
  { id: "waylaid-crates", title: "Waylaid Crates and Merchant's Favor", source: FAVOR,
    text: "WoW Forever's Waylaid Crates (such as Waylaid Crate: Apprentice Herbs) drop now and then from ordinary " +
      "monsters of about levels 7 to 26; they're rare, so most players buy them at the auction house. Open one " +
      "and put in any one bundle it lists, such as 20 Peacebloom or 20 Silverleaf, to fill it; no gathering profession " +
      "is needed. Apprentice and Journeyman crates work from level 10, Expert from 20 and Artisan from 35. A filled " +
      "crate pays 5 to 20 Merchant's Favor at a supply camp: Marcy Baker at Three Corners in Redridge for the Alliance, " +
      "Dokimi just west of the Crossroads in the Barrens for the Horde." },
  { id: "merchants-favor-rewards", title: "What Merchant's Favor buys", source: FAVOR,
    text: "Merchant's Favor stays on the character that earned it. At the supply camps it buys about 317 profession " +
      "recipes no trainer teaches, mostly 30 to 240 Favor each, from a vendor for each profession, plus a pet, a toy, a " +
      "tabard and the Pack Kodo mount. No recipe needs the camp's reputation, which comes from Craftsman's Writs." },
  { id: "dungeon-hall-of-thanes-quests", title: "Getting into the Hall of Thanes", zone: "Dun Morogh",
    source: wiki("Hall of Thanes (instance)"),
    text: "The Hall of Thanes, beneath Ironforge, is an Alliance dungeon for levels 13 to 18. Its quest chain starts " +
      "with Earthseer Farsen overlooking Gol'Bolar Quarry in Dun Morogh and ends with Old Ironforge Incursion." },

  // The new dungeons from the inside, and the library books (ForeverChanges). The last bosses stay out: the lore
  // entries keep them in spoiler sections.
  { id: "dungeon-hall-of-thanes-inside", title: "Inside the Hall of Thanes", zone: "Ironforge",
    source: changes("Hall of Thanes", "/dungeons/hall-of-thanes"),
    text: "The Hall of Thanes is the royal dwarven burial chamber deep beneath Ironforge, and someone has broken into " +
      "it. Adventurers reach it from the High Seat. It was made for the Alliance; Horde adventurers have to sneak or " +
      "fight their way through Ironforge to get in." },
  { id: "dungeon-ruins-of-lordaeron-inside", title: "Inside the Ruins of Lordaeron", zone: "Tirisfal Glades",
    source: changes("Ruins of Lordaeron", "/dungeons/ruins-of-lordaeron"),
    text: "In the Ruins of Lordaeron dungeon, the ruined capital above the Undercity, a necromancer has moved in among " +
      "the Scourge that still linger. Its foes include Viktor the Vile, the Abandoned, Rath'mael, the Baron, " +
      "Witherfang and Bjork. Horde adventurers come to help the Forsaken; Alliance adventurers slip in." },
  { id: "dungeon-ruins-of-lordaeron-quests", title: "Ruins of Lordaeron quests", zone: "Tirisfal Glades",
    source: changes("Ruins of Lordaeron", "/dungeons/ruins-of-lordaeron"),
    text: "Ruins of Lordaeron quests: Captain Truman, just inside the entrance, wants the Baron's head, and General " +
      "Marcus Jonathan in Stormwind takes Bloodied Insignias (Alliance). Theodore Griffs in the Undercity wants the " +
      "Highly Toxic Strain from Witherfang (Horde). The Crest of Lordaeron, found inside, goes to Lady Dena Kennedy " +
      "in Stormwind or Oran Snakewrithe in the Undercity." },
  { id: "dungeon-excavation-site-inside", title: "Inside the Excavation Site", zone: "Wetlands",
    source: changes("Excavation Site: Wetlands", "/dungeons/excavation-site"),
    text: "At the Excavation Site dungeon, above Whelgar's Excavation in the Wetlands, rogue titan constructs, mist " +
      "and flashing lights trouble the dig, and the Explorers' League is taking an interest. Its foes include " +
      "Saltspine, Shadetooth, the Highland Horror and the Relic Guardian, whose Titan Relic goes to Prospector " +
      "Whelgar and then to High Explorer Magellas in Ironforge's Hall of Explorers." },
  { id: "dungeon-excavation-site-quests", title: "Excavation Site quests", zone: "Wetlands",
    source: changes("Excavation Site: Wetlands", "/dungeons/excavation-site"),
    text: "Excavation Site quests can be taken from level 24: Dorin Songblade in Lakeshire, Redridge Mountains, asks " +
      "adventurers to look for his brother Daewyn at the dig, and Rethiel the Greenwarden in the Wetlands wants a " +
      "Highland Horror's root core." },
  { id: "dalaran-dungeon-inside", title: "Getting into the City of Dalaran dungeon", zone: "Alterac Mountains",
    source: changes("City of Dalaran", "/dungeons/city-of-dalaran"),
    text: "The way into the City of Dalaran dungeon runs through Dalaran's sewers to a portal at the end of a long " +
      "pipe; one group member who has done the attunement quests can bring the whole group in. Its foes include " +
      "Atrexis the Grave Knight, Lyn the Ignored, a Mana Devourer and a Fel Ancient. Many of them take no Arcane " +
      "damage, and its constructs and elementals can't be bled or poisoned." },
  { id: "dalaran-quartermaster", title: "The Kirin Tor quartermaster", zone: "Alterac Mountains",
    source: changes("City of Dalaran", "/dungeons/city-of-dalaran"),
    text: "Kills in the City of Dalaran dungeon earn Kirin Tor reputation. At Friendly, Archmage Alvareaux, the Kirin " +
      "Tor quartermaster in Dalaran, sells Blacksmithing, Leatherworking and Tailoring recipes; the Kirin Tor Tabard " +
      "needs Exalted." },
  { id: "system-library-books", title: "Library books", source: changes("Library books", "/library-books"),
    text: "In WoW Forever the librarians of Stormwind and the Undercity reward adventurers who bring them different " +
      "rare books found across Azeroth: ten books earn a necklace, twenty a ring, and twenty-five, from level 30, a " +
      "bow, shield or off-hand that needs level 40. Any class can take part." },
];
