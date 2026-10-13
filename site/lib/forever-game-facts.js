// What WoW Forever changed about classes, talents, systems and the world (Mike, 10/12: "Review all major changes in
// wow forever so we can get accurate answers like talents, classes, legacy points, etc"). Seed facts for
// lib/forever-knowledge.js, each searched on its own, so each names its own subject. Checked against the Forever
// client (build 1.60.1.70338: CharBaseInfo, the Trait trees, SkillLineAbility, AreaTable, Faction, Map, LFGDungeons,
// GlobalStrings) and Blizzard's own articles; never Wowhead. Not here: anything only the client hints at that Blizzard
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
const KIRIN_TOR = { title: "Icy Veins: Horde players aren't welcome in Dalaran in WoW Forever",
  url: "https://www.icy-veins.com/wow-forever/news/wow-forever-confirms-horde-players-arent-welcome-in-dalaran/" };
const wiki = page => ({ title: `Warcraft Wiki: ${page} (Forever)`, url: `https://warcraft.wiki.gg/wiki/${page.replace(/ /g, "_")}` });

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
  // Races
  { id: "racials-alliance", title: "Alliance racials in WoW Forever", source: CLIENT,
    text: "WoW Forever gives each race two active and two passive racials. Humans: Will to Survive, Perception, " +
      "Sword Specialization, The Human Spirit; dwarves: Stoneform, Find Treasure, Mace Specialization, Big Game " +
      "Hunter; night elves: Shadowmeld, Elune's Light, Quickness, Wisp Spirit; gnomes: Escape Artist, Eureka!, " +
      "Expansive Mind, Engineering Specialization. Diplomacy, Gun Specialization and resistance racials are gone." },
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
  { id: "system-professions", title: "Professions in WoW Forever", source: PANEL,
    text: "WoW Forever keeps the original professions with over 600 new recipes; Blizzard hasn't announced " +
      "Jewelcrafting or Inscription. Camping gives each profession camp objects." },
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
  { id: "raid-schedule", title: "When WoW Forever's raids open", source: ROADMAP,
    text: "WoW Forever's raids open on 9 December 2026: the Barrow Deeps (10 players), Hyjal Summit (20) and " +
      "Onyxia's Lair (40). The Barrow Deeps are where Illidan Stormrage was imprisoned." },
  { id: "rep-kirin-tor", title: "Kirin Tor reputation", zone: "Alterac Mountains", source: KIRIN_TOR,
    text: "The Kirin Tor are an Alliance reputation in WoW Forever: Horde characters start Hated and don't get full " +
      "access to Dalaran, though Horde groups can run the City of Dalaran dungeon through their own quests." },
  { id: "dungeon-hall-of-thanes-quests", title: "Getting into the Hall of Thanes", zone: "Dun Morogh",
    source: wiki("Hall of Thanes (instance)"),
    text: "The Hall of Thanes, beneath Ironforge, is an Alliance dungeon for levels 13 to 18. Its quest chain starts " +
      "with Earthseer Farsen overlooking Gol'Bolar Quarry in Dun Morogh and ends with Old Ironforge Incursion." },
];
