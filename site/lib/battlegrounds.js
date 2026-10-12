// The battlegrounds (LOR-430): a place in one is a battle between the Alliance and the Horde, not a land or a
// dungeon, and a profile story tells it that way. Each is known by its English name and by the client's names in the
// bundled languages (data/i18n/<locale>/client_names.json, AreaTable), with a line on what each side fights for there,
// from its lore entry (data/lore/zone_<key>.json: keep the two in step): stakes for the profile story, short for a
// chapter's highlight (lib/chapters.js). Kept outside functions/ so Pages doesn't route it.

export const BATTLEGROUNDS = {
  "Warsong Gulch": {
    short: "over the Horde's logging of Ashenvale",
    names: ["Warsongschlucht", "Goulet des Warsong", "Garganta Grito de Guerra", "Ravina Brado Guerreiro",
            "Ущелье Песни Войны"],
    stakes: "the Warsong clan cuts Ashenvale's timber there for the Horde, and the night elves of Silverwing Hold " +
      "fight to drive them out of their sacred forest, each side raiding the other's stronghold for its flag",
  },
  "Arathi Basin": {
    short: "over the riches of the Arathi Basin",
    names: ["Arathibecken", "Bassin d'Arathi", "Cuenca de Arathi", "Bacia Arathi", "Низина Арати"],
    stakes: "the League of Arathor fights to win back the lost lands of Arathor, and the Forsaken Defilers to seize " +
      "the basin's farms, mills and mines and cut the humans off from their dwarven allies",
  },
  "Alterac Valley": {
    short: "over the Frostwolves' home valley",
    names: ["Alteractal", "Vallée d'Alterac", "Valle de Alterac", "Vale Alterac", "Альтеракская долина"],
    stakes: "the Frostwolf orcs, Thrall's own clan, fight to drive the Stormpike dwarves out of their home, and " +
      "each army storms the other's towers to reach its general",
  },
  "Darkspear Islands": {
    short: "over the Darkspear trolls' sacred isles",
    names: ["Darkspear-Inseln", "Îles des Sombrelances", "Islas Lanza Negra", "Ilhas Lançanegra",
            "Острова Черного Копья"],
    stakes: "the ceremonial islands of the Darkspear trolls off Kalimdor's coast: sacred ground the Horde will not " +
      "give up, and a foothold the Alliance wants, won by holding the islands' strongpoints, seizing the Darkspear " +
      "Islands flag and gathering 2000 resources first",
  },
};

// Maps, not objects: a pasted "constructor" or "__proto__" must not find anything.
const BY_NAME = new Map(Object.entries(BATTLEGROUNDS)
  .flatMap(([en, b]) => [en, ...b.names].map(n => [n.toLowerCase(), en])));

// The English name of the battleground a place name is, or null.
export const battleground = name => BY_NAME.get(String(name ?? "").trim().toLowerCase()) ?? null;
