// Where the original game's dungeons and raids are, and who holds the zones around them (LOR-670, the answer log
// 10/18: an Alliance warrior asking the way to the Scarlet Monastery was sent through the Undercity and offered the
// Sepulcher's flight point, both Horde). lib/forever-place-facts.js gives the way to a dungeon's zone from these, so a
// dungeon's name is a place to go to; Forever's own new dungeons are in lib/forever-knowledge.js.
//
// DUNGEONS: [how it's said (with its "the"), other names players use (normalized by the reader: "RFC", "Ulda"), the
// zones its way in lies in (the nearer one to the asker is taken), where the way in is (finishing "<name> ..."; most are
// "is in ..."), the Warcraft Wiki page or pages that say so], in our words from the cached wiki pages (data/raw/wiki).
// The cache has no page of its own for Blackrock Depths, Blackrock Spire, Molten Core and Blackwing Lair, nor for the
// two Ahn'Qiraj raids, so those lean on Blackrock Mountain's and the Gates of Ahn'Qiraj's pages, and Naxxramas on the
// Plaguewood's.
//
// ZONE_SIDES: who holds each zone, from data/zone_factions.json (classic ownership; the zones it calls contested or
// leaves out are held by both). A test keeps the two in step.

const MOUNTAIN = "is inside Blackrock Mountain, the volcano between the Searing Gorge and the Burning Steppes (the path " +
  "in from the Searing Gorge starts at (34, 74))";
const MOUNTAIN_ZONES = ["Burning Steppes", "Searing Gorge"];
const GATES = "is in southwestern Silithus, through the Gates of Ahn'Qiraj past the Scarab Wall";

export const DUNGEONS = [
  ["Ragefire Chasm", ["rfc", "ragefire"], ["Orgrimmar"],
    "is in Orgrimmar: the entry portal is in the Cleft of Shadow, next to Neeru Fireblade's tent", "Ragefire Chasm (Classic)"],
  ["Wailing Caverns", ["wc"], ["The Barrens"],
    "is in the Barrens, south of the Crossroads, on the north side of the Lushwater Oasis", "Wailing Caverns"],
  ["the Deadmines", ["dead mines"], ["Westfall"],
    "are in southwestern Westfall: the way in is in the town of Moonbrook (42, 72)", "Deadmines"],
  ["Shadowfang Keep", ["sfk"], ["Silverpine Forest"],
    "is in southern Silverpine Forest, near Pyrewood Village (45, 68)", "Shadowfang Keep (Classic)"],
  ["Blackfathom Deeps", ["bfd", "blackfathom"], ["Ashenvale"],
    "is on the Zoram Strand in northwestern Ashenvale: the way in is an underwater entrance you swim down into",
    "Blackfathom Deeps (Classic)"],
  ["the Stockade", ["stormwind stockade", "stockades"], ["Stormwind City"],
    "is in Stormwind City, in the canal district by the Mage Quarter: a meeting stone marks its doorway", "Stormwind Stockade"],
  ["Gnomeregan", ["gnomer"], ["Dun Morogh"],
    "is in the west of Dun Morogh, past Brewnall Village (24, 40)", "Gnomeregan"],
  ["Razorfen Kraul", ["rfk"], ["The Barrens"],
    "is in the Barrens, at the far southern edge, on the west side", "Razorfen Kraul (Classic)"],
  ["Razorfen Downs", ["rfd"], ["The Barrens"],
    "is in the Barrens, at the far southern edge, on the east side", "Razorfen Downs (Classic)"],
  // Players name its wings (the answer log 10/18: "how do I get to Scarlet Graveyard?"); "sm graveyard" is "sm" already.
  ["the Scarlet Monastery", ["sm", "scarlet graveyard", "scarlet library", "scarlet armory", "scarlet armoury",
    "scarlet cathedral"], ["Tirisfal Glades"],
    "is in the northeast corner of Tirisfal Glades. Its four wings are each a dungeon of their own: the Graveyard " +
    "(levels 26-36, the left-most entrance), the Library (29-39, the right-most entrance), the Armory (32-42) and the " +
    "Cathedral (35-45)", ["Scarlet Monastery (Classic)", "Scarlet Monastery Graveyard", "Scarlet Monastery Library",
    "Scarlet Monastery Armory", "Scarlet Monastery Cathedral"]],
  ["Uldaman", ["ulda"], ["Badlands"], "is in the northern part of the Badlands", "Uldaman"],
  ["Zul'Farrak", ["zul farrak", "zf"], ["Tanaris"], "is in northwestern Tanaris, at Sandsorrow Watch", "Zul'Farrak"],
  ["Maraudon", ["mara"], ["Desolace"],
    "is in the Valley of Spears in western Desolace, at the valley's southwestern end", ["Maraudon", "Valley of Spears"]],
  ["the Sunken Temple", ["temple of atalhakkar", "atalhakkar"], ["Swamp of Sorrows"],
    "is in the eastern part of the Swamp of Sorrows, sunk in the Pool of Tears (the Temple of Atal'Hakkar)", "Temple of Atal'Hakkar"],
  ["Blackrock Depths", ["brd"], MOUNTAIN_ZONES, MOUNTAIN, "Blackrock Mountain"],
  ["Blackrock Spire", ["upper blackrock spire", "lower blackrock spire", "ubrs", "lbrs", "brs"], MOUNTAIN_ZONES,
    MOUNTAIN, "Blackrock Mountain"],
  ["Molten Core", ["mc"], MOUNTAIN_ZONES, MOUNTAIN, "Blackrock Mountain"],
  ["Blackwing Lair", ["bwl"], MOUNTAIN_ZONES, `${MOUNTAIN}, through Blackrock Spire`, "Blackrock Mountain"],
  ["Dire Maul", [], ["Feralas"], "is in the High Wilderness of north-central Feralas", "Dire Maul"],
  ["Stratholme", ["strat"], ["Eastern Plaguelands"],
    "is a ruined city in the Eastern Plaguelands, entered through its main gate", "Stratholme (Classic)"],
  ["Scholomance", ["scholo"], ["Western Plaguelands"],
    "is on Caer Darrow in the Western Plaguelands, in the ruins of the House of Barov above the abandoned city", "Scholomance (Classic)"],
  ["Onyxia's Lair", ["onyxia", "ony"], ["Dustwallow Marsh"], "is in the Wyrmbog in Dustwallow Marsh", "Onyxia's Lair"],
  ["Zul'Gurub", ["zul gurub", "zg"], ["Stranglethorn Vale"], "is in northeastern Stranglethorn Vale", "Zul'Gurub"],
  ["the Ruins of Ahn'Qiraj", ["ruins of ahn qiraj", "ruins of aq", "aq20"], ["Silithus"], GATES,
    "Gates of Ahn'Qiraj (subzone)"],
  ["the Temple of Ahn'Qiraj", ["temple of ahn qiraj", "temple of aq", "aq40"], ["Silithus"], GATES,
    "Gates of Ahn'Qiraj (subzone)"],
  ["Ahn'Qiraj", ["ahn qiraj", "aq"], ["Silithus"],
    "is in southwestern Silithus: the Ruins and the Temple of Ahn'Qiraj lie through the Gates of Ahn'Qiraj, past the Scarab Wall",
    "Gates of Ahn'Qiraj (subzone)"],
  ["Naxxramas", ["naxx"], ["Eastern Plaguelands"],
    "is in the Eastern Plaguelands: the Scourge's necropolis floats above the Plaguewood, near Stratholme", "Plaguewood"],
];

export const ZONE_SIDES = {
  Alliance: ["Darkshore", "Darnassus", "Dun Morogh", "Duskwood", "Elwynn Forest", "Ironforge", "Loch Modan",
    "Redridge Mountains", "Stormwind City", "Teldrassil", "Westfall", "Wetlands"],
  Horde: ["Durotar", "Mulgore", "Orgrimmar", "Silverpine Forest", "The Barrens", "Thunder Bluff", "Tirisfal Glades",
    "Undercity"],
};
