// Willo managing their notebook for them (Mike, 2026-10-19: "I also want Willow to be able to edit and delete the notes
// and manage them for me"): taking many lines off at once (what's done, a list, their notes, a page, reminders said or
// waiting), moving lines to the other page, and "undo that". The site decides, never the model: what a clear takes is
// read from the page itself, more than one item is asked about first ("That's 3 done items on Húrin's page: … Take them
// all off? Say yes."), and a yes takes off what that question named, read again from the page as it is now. Her words
// say what was written and nothing else (LOR-677: "I have cleared your notes" with nothing cleared). One line, a merge
// and a move are the notebook's own tools (lib/willo-notebook.js); this file holds the rest. Kept outside functions/ so
// Pages doesn't route it.

import { linesOf, headingKey, titleOf, ACCOUNT_PAGE } from "./willo-notebook.js";

const CLEARY = String.raw`(?:clear(?:\s+out|\s+off)?|delete|remove|erase|wipe(?:\s+out)?|empty(?:\s+out)?|get\s+rid\s+of|take\s+(?:off|out)|throw\s+out|clean\s+(?:up|out)|tidy(?:\s+up)?|scrap|purge)`;
const MINE = String.raw`(?:(?:all\s+(?:of\s+)?)?(?:my|the|your|our)\s+|all\s+)`;
const DONE = String.raw`(?:done|ticked(?:[\s-]off)?|checked(?:[\s-]off)?|finished|completed|crossed[\s-]off)`;
const NOT_ONE = String.raw`(?!\s+(?:about|on|for|that|with|saying|called|of|from)\b)`;
// Reminders: said ones ("clear my done reminders", "delete the old reminders"), or every one ("clear all my reminders").
const BULK_REMINDERS = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?${MINE}?(?:(${DONE}|said|old|past|fired|used|spent|expired)\s+)?reminders\b${NOT_ONE}`, "i");
// What's ticked off: "clear my done items", "delete everything I've finished", "tidy up my list".
const BULK_DONE = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?${MINE}?${DONE}\s+(?:items?|to-?dos?|ones|lines|tasks|things|stuff|entries)\b` +
  String.raw`|\b${CLEARY}\s+(?:out\s+)?(?:everything|all|the\s+ones|what)\s+(?:(?:i(?:'ve|\s+have)\s+)?(?:${DONE}|ticked|checked|crossed\s+off))\b` +
  String.raw`|\b(?:tidy|clean)\s+up\s+${MINE}?(?:to-?do\s+)?(?:list|to-?dos?|notebook)\b`, "i");
// A whole page: "clear my notebook", "wipe everything", "clear Húrin's page".
const BULK_PAGE = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?(?:${MINE}(?:whole\s+|entire\s+)?(?:notebook|page)\b|everything\b(?!\s+(?:about|on\s+(?!my|the)|for)\b)|[\p{L}]+'s\s+page\b)`, "iu");
const BULK_NOTES = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?${MINE}(?:whole\s+|entire\s+)?notes\b${NOT_ONE}`, "i");
const BULK_TODOS = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?${MINE}(?:whole\s+|entire\s+)?(?:to-?do\s+list|to-?dos|list)\b${NOT_ONE}`, "i");
// A named list: "clear the Tailoring list", "empty my shopping list" (a heading the page has: checked by bulkTargets).
const BULK_LIST = new RegExp(String.raw`\b${CLEARY}\s+(?:out\s+)?${MINE}(?:whole\s+|entire\s+)?([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)\s+(?:list|section)\b${NOT_ONE}`, "iu");
const ALL_PAGES = /\b(?:both\s+pages|every\s+page|all\s+(?:my\s+)?pages|everywhere)\b/i;
const ACCOUNT_SAID = /\b(?:all|every|each)\s+(?:of\s+)?(?:my\s+)?(?:characters?|toons?|alts?)\b|\baccount(?:[- ]wide)?\b|\bpage\s+for\s+all\b/i;

// What a question asks to take off, or null: {kind: "reminders" (said: true for only those said), "done", "page",
// "notes", "todos" or "list" (heading: its name as said), where: "current", "account" or "both"}.
export function bulkScope(question) {
  const q = String(question || "").replace(/’/g, "'");
  const where = ALL_PAGES.test(q) ? "both" : ACCOUNT_SAID.test(q) ? "account" : "current";
  let m;
  if ((m = BULK_REMINDERS.exec(q))) return { kind: "reminders", said: Boolean(m[1]), where };
  if (BULK_DONE.test(q)) return { kind: "done", where };
  if (BULK_NOTES.test(q)) return { kind: "notes", where };
  if (BULK_PAGE.test(q)) return { kind: "page", where };
  if (BULK_TODOS.test(q)) return { kind: "todos", where };
  if ((m = BULK_LIST.exec(q))) return { kind: "list", heading: m[1], where };
  return null;
}

// The pages a scope looks at, by where it said: this character's page (the account's when there's none, or when only it
// has any), the account's, or both.
const pagesFor = (view, where) => where === "both" ? [view.current, ACCOUNT_PAGE].filter(Boolean)
  : where === "account" || !view.current ? [ACCOUNT_PAGE] : [view.current];
const isItem = l => l.kind === "todo" || l.kind === "bullet" || l.kind === "text";
// Willo's own headings: a clear of their lists never takes what she keeps there (goals, pins) unless they name it.
const OWN = new Set(["goals", "pins"]);

// What a scope takes off, read from the pages as they are: [{page, targets: [{raw, text, kind}]}] (pages with nothing
// left out), and for reminders [{reminder}] from `reminders` (the account's, said ones too: lib/willo-notebook.js
// allReminders). {found: [...], reminders: [...], none: why there's nothing} .
export function bulkTargets(view, scope, reminders = []) {
  if (scope.kind === "reminders") {
    const pages = new Set(pagesFor(view, scope.where === "current" ? "both" : scope.where));
    const mine = reminders.filter(r => pages.has(r.page) && (!scope.said || r.fired));
    return { found: [], reminders: mine, scope };
  }
  const found = [];
  for (const page of pagesFor(view, scope.where)) {
    const lines = linesOf(view.pages?.[page]?.body);
    let heading = null;
    const targets = [];
    for (const l of lines) {
      if (l.kind === "heading") { heading = l; continue; }
      if (!isItem(l)) continue;
      const under = heading ? headingKey(heading.text) : "";
      const take = scope.kind === "done" ? l.kind === "todo" && l.done
        : scope.kind === "notes" ? under === headingKey("Notes")
        : scope.kind === "todos" ? under === headingKey("To do") || (!heading && l.kind === "todo")
        : scope.kind === "list" ? under === headingKey(scope.heading)
        : scope.kind === "page" ? !OWN.has(under) : false;
      if (take) targets.push({ raw: l.raw, text: l.text, kind: l.kind });
    }
    if (targets.length) found.push({ page, targets });
  }
  // "Clear my done items" with this character's page empty of them: the account's page, when it has some.
  if (!found.length && scope.where === "current" && view.current) {
    const other = bulkTargets({ ...view, current: null }, { ...scope, where: "account" });
    if (other.found.length) return other;
  }
  // "Clear my notes" with no Notes list: the notebook is their notes, so the page's lines (the stream, 10/18: "Now clear
  // your notes").
  if (!found.length && scope.kind === "notes") return bulkTargets(view, { ...scope, kind: "page" });
  return { found, reminders: [], scope };
}

const count = n => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
const listOf = items => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const some = (items, n = 3) => items.length > n ? `${items.slice(0, n).join(", ")} and ${count(items.length - n)} more` : listOf(items);
const plain = t => String(t).replace(/[.!\s]+$/, "");
// What a scope is called, in her words and in the question's: "done items", "notes", "to-dos", "lines under Tailoring".
const WHAT = { done: "done items", notes: "notes", todos: "to-dos", page: "lines", reminders: "reminders" };
const whatOf = (scope, n) => {
  if (scope.kind === "list") return `${n === 1 ? "line" : "lines"} under ${scope.heading}`;
  const w = scope.kind === "reminders" && scope.said ? "said reminders" : WHAT[scope.kind];
  return n === 1 ? w.replace(/s$/, "") : w;
};
const whereOf = pages => pages.length > 1 ? "on both your pages" : pages[0] === ACCOUNT_PAGE ? "on the page for all your characters"
  : `on ${titleOf(pages[0])}'s page`;

// The ask before taking off more than one: "That's 3 done items on Húrin's page: a, b and c. Take them all off? Say
// yes." Its first words are what a yes reads back (BULK_ASK).
export function bulkAsk(scope, { found, reminders }) {
  const texts = scope.kind === "reminders" ? reminders.map(r => plain(r.text)) : found.flatMap(f => f.targets.map(t => plain(t.text)));
  const n = texts.length;
  const where = scope.kind === "reminders" ? "" : ` ${whereOf(found.map(f => f.page))}`;
  const label = whatOf(scope, n);
  return `That's ${count(n)} ${label}${where}: ${some(texts)}. Take ${n === 2 ? "both" : "them all"} off? Say yes.`;
}
// Her ask, read back: the scope it named. null when her last words weren't one.
const BULK_ASK = /That's (\w+) (done items|notes|to-dos|lines|said reminders|reminders|lines under ([^:]+?))(?: on (both your pages|the page for all your characters|(.+?)'s page))?: [^?]*\? Say yes\./;
function askedScope(previous) {
  const m = BULK_ASK.exec(String(previous || ""));
  if (!m) return null;
  const kind = m[3] ? "list" : { "done items": "done", notes: "notes", "to-dos": "todos", lines: "page",
    "said reminders": "reminders", reminders: "reminders" }[m[2]];
  const where = m[4] === "both your pages" ? "both" : m[4] === "the page for all your characters" ? "account" : "current";
  return { kind, where, ...(m[3] ? { heading: m[3] } : {}), ...(m[2] === "said reminders" ? { said: true } : {}), who: m[5] || null };
}
const YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|do\s+it|go\s+ahead|please(?:\s+do)?|all\s+of\s+them|take\s+them\s+(?:all\s+)?off|clear\s+them)\b(?![^.?!]*\b(?:not|don'?t|wait)\b)/i;
const NO = /^\s*(?:no|nope|nah|keep|don'?t|wait|never\s*mind|cancel|stop|not)\b|^\s*(?:yes|yeah)\b[^.?!]*\b(?:not|don'?t|wait)\b/i;
// The answer to her ask: "yes", "no", or null (anything else, or no ask before it).
export function bulkTurn(question, previous) {
  if (!askedScope(previous)) return null;
  const q = String(question || "").replace(/’/g, "'");
  return NO.test(q) ? "no" : YES.test(q) ? "yes" : null;
}

// What the site does with a clear: {noted} (lib/willo-notebook.js's {page, op}, or {ops: [...]} over both pages, or
// {page, op: {op: "unremind"}} for reminders), {answer} (her ask, or why there's nothing), or null when it isn't one.
// A yes takes what her ask named, read again now; a no keeps them. reminders: the account's (allReminders).
export function bulkReply(view, question, previous, reminders = []) {
  if (!view) return null;
  const turn = bulkTurn(question, previous);
  let scope = turn ? askedScope(previous) : bulkScope(question);
  if (!scope) return null;
  if (turn === "no") return { answer: "All right, I'll keep them." };
  if (turn && scope.who && view.current && titleOf(view.current) !== scope.who)
    return { answer: `I haven't taken anything off: that was about ${scope.who}'s page, and you're on ${titleOf(view.current)} now.` };
  const got = bulkTargets(view, scope, reminders);
  scope = got.scope || scope;
  const n = scope.kind === "reminders" ? got.reminders.length : got.found.reduce((a, f) => a + f.targets.length, 0);
  if (!n) return { answer: noneLine(scope, view) };
  if (n > 1 && !turn) return { answer: bulkAsk(scope, got), asked: true };
  const bulk = { label: whatOf(scope, n), n };
  if (scope.kind === "reminders") return { noted: { page: got.reminders[0].page, op: { op: "unremind", reminders: got.reminders }, bulk } };
  const ops = got.found.map(f => ({ page: f.page, op: { op: "remove", targets: f.targets } }));
  return { noted: ops.length === 1 ? { ...ops[0], bulk } : { ops, page: ops[0].page, op: ops[0].op, bulk } };
}
function noneLine(scope, view) {
  const where = scope.kind === "reminders" ? "" : ` ${whereOf(pagesFor(view, scope.where))}`;
  if (scope.kind === "list") return `There's no list called ${scope.heading}${where}.`;
  return `You have no ${whatOf(scope, 2)}${where} to take off.`;
}

// "Undo that", "put it back", "bring it back", "take that back" (short; never "how do I undo a quest?").
const UNDO = /^\s*(?:(?:no|oops|wait|hey|ok(?:ay)?|willo|willow|actually)\b[,!.]?\s+)*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:undo(?:\s+(?:that|it|this|the\s+last\s+(?:one|change|thing)|what\s+you\s+(?:just\s+)?did))?|put\s+(?:it|that|them|those)\s+back|bring\s+(?:it|that|them|those)\s+back|take\s+(?:that|it)\s+back|revert\s+(?:that|it)|restore\s+(?:that|it|them))\b[\s,.!]*(?:please)?[\s.!?]*$/i;
export const undoAsk = question => UNDO.test(String(question || "").replace(/’/g, "'"));
// How long after a change "undo that" still means it.
export const UNDO_MINUTES = 30;

// What "undo that" undoes: only her own last change in this chat, which her last answer named, on the page (or both pages
// a move changed) last changed in the last UNDO_MINUTES, with its earlier version kept (readNotebook {prev: true}):
// [{page, version, body, prev}] newest first, the page that gets lines back first; [] for nothing of hers to undo; or
// null for a move whose other page isn't here (a change from another character's chat). The QA run (10/19): on Melkor,
// in a new chat, "undo that" undid a move made from Tulkas's chat on the shared page only, and the note was on neither.
export function undoPages(view, now = new Date(), previous = "") {
  const said = String(previous || "").toLowerCase();
  if (!said.trim()) return [];
  const rows = Object.values(view?.pages || {}).filter(r => typeof r.prev_body === "string" && r.updated
    && now.getTime() - Date.parse(r.updated) <= UNDO_MINUTES * 60e3 && named(r, said))
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  if (!rows.length) return [];
  const last = Date.parse(rows[0].updated);
  const pages = rows.filter(r => last - Date.parse(r.updated) <= 2000)
    .map(r => ({ page: r.page, version: r.version, body: r.body || "", prev: r.prev_body }));
  if (MOVED.test(previous) && pages.length < 2) return null;
  // Lines back first: a later page that fails to undo leaves a line on both pages, never on neither.
  return pages.sort((a, b) => adds(b) - adds(a));
}
const MOVED = /^\s*Moved to (?:the page for all your characters|[^:]+'s page):/;
const itemsOf = body => new Set(linesOf(body).filter(isItem).map(l => l.text));
// The lines a page's last change took or gave: what her answer about it named.
function changedTexts(r) {
  const now = itemsOf(r.body), was = itemsOf(r.prev_body);
  return [...[...was].filter(t => !now.has(t)), ...[...now].filter(t => !was.has(t))];
}
// Her last answer names a line its change touched: its words, or the head of them (a pin's or a goal's name).
const named = (r, said) => changedTexts(r).some(t => {
  const head = plain(t).split(/ · |: /)[0].toLowerCase();
  return said.includes(plain(t).toLowerCase()) || (head.length >= 4 && said.includes(head));
});
const adds = u => { const now = itemsOf(u.body); return [...itemsOf(u.prev)].filter(t => !now.has(t)).length; };
export const UNDO_ELSEWHERE = "That move took a line from another character's page, so I can't undo it from here. Ask me " +
  "from that character's chat, or move it back.";
// Her line for an undo, from what comes back and what goes again: "Undone: Sell the boar meat is back on your list."
export function undoLine(undone) {
  const back = [], gone = [];
  for (const u of undone) {
    const now = new Set(linesOf(u.body).filter(isItem).map(l => l.raw.trim()));
    const was = new Set(linesOf(u.prev).filter(isItem).map(l => l.raw.trim()));
    // A pin said by its name (and note), never its map numbers and day.
    const said = t => plain(String(t).split(" · ")[0]);
    for (const l of linesOf(u.prev)) if (isItem(l) && !now.has(l.raw.trim())) back.push(said(l.text));
    for (const l of linesOf(u.body)) if (isItem(l) && !was.has(l.raw.trim())) gone.push(said(l.text));
  }
  const b = [...new Set(back)], g = [...new Set(gone)].filter(t => !b.includes(t));
  if (b.length && g.length) return `Undone: ${some(b)} back as ${b.length === 1 ? "it was" : "they were"}.`;
  if (b.length) return `Undone: ${some(b)} ${b.length === 1 ? "is" : "are"} back.`;
  if (g.length) return `Undone: ${some(g)} ${g.length === 1 ? "is" : "are"} gone again.`;
  return "Undone: the page is back as it was.";
}
export const NOTHING_TO_UNDO = "There's nothing of mine to undo just now.";
export const REMINDER_GONE_LINE = "I can't bring back a reminder once it's taken off. Tell me again and I'll set it.";
// Her last words were a reminder taken off ("Taken off: sell your cloth."): one she can't bring back.
export const tookReminder = previous => /^(?:Taken off|That reminder's gone): /.test(String(previous || "").trim());
// Her last words set a reminder ("At 7:16 PM I'll remind you: check."): the one to take off again, waiting, set in the
// last UNDO_MINUTES, whose words her line said.
export function setReminder(view, previous, now = new Date()) {
  const said = String(previous || "");
  if (!/\bI'll (?:remind|tell) you\b/.test(said)) return null;
  return (view?.reminders || []).filter(r => !r.fired && now.getTime() - Date.parse(r.created) <= UNDO_MINUTES * 60e3
    && said.includes(plain(r.text))).sort((a, b) => Date.parse(b.created) - Date.parse(a.created))[0] || null;
}

// A move to the other page (lib/willo-notebook.js notebookCall's op "relocate"): the lines off one page and onto the
// other, both worked out on the pages her answer read. [{page, op}] for the two writes, each applyOp's.
export function relocateOps({ page, op }) {
  return [{ page, op: { op: "remove", targets: op.targets } },
    { page: op.to, op: { op: "receive", targets: op.targets } }];
}

// Her line once a clear is written, from what was taken off: "Taken off, three done items: a, b and c."
export function bulkLine(bulk, changed) {
  const texts = changed.map(plain);
  return texts.length === 1 ? `Taken off: ${texts[0]}.` : `Taken off, ${count(texts.length)} ${bulk.label}: ${some(texts, 4)}.`;
}
// Her line once lines are moved to the other page: "Moved to the page for all your characters: Hearthstone set to Goldshire."
export function relocateLine(to, changed) {
  return `Moved to ${to === ACCOUNT_PAGE ? "the page for all your characters" : `${titleOf(to)}'s page`}: ${some(changed.map(plain), 4)}.`;
}
