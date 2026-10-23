// Public names, query fields and the controls actually present in the product admin UI.
// This is deliberately not a generic proxy for every operation the old admin key permits.
export const READ_QUERIES = Object.freeze({
  main: {}, costs: {}, creators: {}, curseforge: {}, "plans-usage": { days: ["14", "30"] },
  retention: { paid: ["0", "1"] },
  sources: { from: "date", to: "date", by: ["landing"], search: ["0", "1"] },
  "voice-status": {},
  willo: { answers: ["1"], queue: ["1"], quality: ["1"],
    status: ["open", "new", "triaged", "fixed", "checked", "dismissed", "fact", "all"],
    since: "time", after: "integer", limit: "limit", days: "days" },
  "translation-summary": {}, "translation-review": { status: ["new", "accepted", "rejected", "pulled", "all"],
    locale: "locale", user: "id", q: "search", offset: "integer", limit: "pageLimit" },
  "clip-export": { status: ["open", "all", "done", "kept", "rejected"], since: "integer" }, downloads: {},
  "north-star": {}, pool: {},
});

export class ContractError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const bad = message => { throw new ContractError(message); };
const own = (object, key) => Object.hasOwn(object, key);
const text = (value, max, empty = false) => typeof value === "string" && value.length <= max && (empty || value.trim().length > 0);
const integer = (value, max, min = 0) => ["number", "string"].includes(typeof value) && /^(0|[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const id = value => text(value, 128) && /^[\w-]+$/.test(value);
const locale = value => typeof value === "string" && /^[a-z]{2}[A-Z]{2}$/.test(value);

export function validateQuery(name, query) {
  const schema = READ_QUERIES[name];
  if (!schema) throw new ContractError("This view does not accept reads.", 405);
  for (const [key, value] of query) {
    if (!own(schema, key) || query.getAll(key).length !== 1) bad("Unknown or repeated query field: " + key);
    const rule = schema[key];
    let valid = Array.isArray(rule) ? rule.includes(value) : false;
    if (rule === "date") valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (rule === "time") valid = text(value, 40) && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
    if (rule === "integer") valid = integer(value, 2147483647);
    if (rule === "limit") valid = integer(value, query.has("queue") ? 500 : 1000, 1);
    if (rule === "pageLimit") valid = integer(value, 2000, 1);
    if (rule === "days") valid = integer(value, 14, 1);
    if (rule === "id") valid = id(value);
    if (rule === "locale") valid = value === "" || locale(value);
    if (rule === "search") valid = text(value, 300, true);
    if (!valid) bad("Invalid query field: " + key);
  }
  if (name === "willo" && ["answers", "queue", "quality"].filter(k => query.has(k)).length > 1) bad("Choose one Willo report.");
  if (name === "willo") {
    const allowed = query.has("answers") ? ["answers", "since", "after", "limit"]
      : query.has("queue") ? ["queue", "status", "since", "after", "limit"]
      : query.has("quality") ? ["quality", "days"] : [];
    for (const key of query.keys()) if (!allowed.includes(key)) bad("Query field does not apply to this Willo report: " + key);
  }
  if (name === "sources") {
    const to = Date.parse(query.get("to") || new Date().toISOString().slice(0, 10));
    const from = query.has("from") ? Date.parse(query.get("from")) : to - 29 * 864e5;
    const days = (to - from) / 864e5;
    if (days < 0 || days > 366) bad("Choose a date range of at most 366 days.");
  }
}

// required fields | optional fields. Field validators below also reject objects in text fields.
const ACTIONS = {
  main: {
    status: ["id status", "resolution reason"], "delete-feedback": ["id"],
    "voice-status": ["id status", "reason"], "delete-voice": ["id"],
    "status-translation": ["id status"], "status-translation-report": ["id status", "resolution reason"],
    "delete-translation": ["id"], "delete-translation-report": ["id"],
    "contrib-reject": ["uploader"], "contrib-restore": ["uploader"], "contrib-pick": ["id pick", "reason"],
    "exclude-account": ["id"], "count-account": ["id"], "delete-subscriber": ["email"],
  },
  creators: { save: ["code name", "contact account discount share_pct months gift promo_id channel"],
    approve: ["id code"], decline: ["id"], retire: ["code"], restore: ["code"],
    pay: ["code method expected_cents", "note"], "stripe-payouts": ["on"] },
  retention: { preview: ["id subject text"], write: ["id subject text reviewed"] },
  sources: { link: ["slug label target"], retire: ["slug"], restore: ["slug"] },
  willo: { "feedback-status": ["id status", "note"], "friend-report-done": ["id"],
    "fact-add": ["title text", "zone source_title source_url feedback_id feedback_ids origin"],
    "fact-remove": ["id"], "queue-fixed": ["ids how", "ref note"] },
  "translation-decide": { "": ["status", "ids user locale reasons"] },
  "clip-resolve": { "": ["ids status"] }, "clip-reject": { "": ["uploader", "restore"] },
};
export const WRITE_NAMES = Object.freeze(Object.keys(ACTIONS));
const words = s => (s || "").split(" ").filter(Boolean);
export function validateAction(name, body) {
  if (!own(ACTIONS, name)) throw new ContractError("This view is read-only.", 405);
  if (!body || typeof body !== "object" || Array.isArray(body)) bad("Expected a JSON object.");
  const action = name.startsWith("translation-") || name.startsWith("clip-") ? "" : body.action;
  if (typeof action !== "string" || !own(ACTIONS[name], action)) bad("Unknown action.");
  const [required, optional] = ACTIONS[name][action];
  const allowed = [...words(required), ...words(optional), ...(action ? ["action"] : [])];
  for (const field of Object.keys(body)) if (!allowed.includes(field)) bad("Unknown action field: " + field);
  for (const field of words(required)) if (!own(body, field)) bad("Missing action field: " + field);
  for (const [field, value] of Object.entries(body)) {
    let valid = true;
    if (field === "action") continue;
    if (value === null && ["reason", "resolution"].includes(field)) continue;
    if (field === "reviewed") valid = value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 5 && ["to", "from", "replyTo", "subject", "text"].every(k => own(value, k) && text(value[k], k === "text" ? 20000 : 500));
    else if (["ids", "feedback_ids"].includes(field)) valid = Array.isArray(value) && value.length > 0 && value.length <= (name === "translation-decide" ? 2000 : 100) && value.every(n => integer(n, 2147483647, 1));
    else if (field === "id") valid = name === "retention" || name === "creators" || action === "fact-remove" || ["exclude-account", "count-account"].includes(action) ? id(value) : integer(value, 2147483647, 1);
    else if (field === "feedback_id") valid = integer(value, 2147483647, 1);
    else if (field === "expected_cents") valid = integer(value, 2147483647, 1);
    else if (["on", "restore"].includes(field)) valid = typeof value === "boolean";
    else if (field === "locale") valid = locale(value);
    else if (field === "user") valid = id(value);
    else if (field === "email") valid = text(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    else if (field === "uploader") valid = text(value, 128) && (name === "clip-reject"
      ? /^(u|ip):[\w-]{1,80}$/.test(value) : /^[uihx]:[\w-]{1,64}$/.test(value));
    else if (["discount", "share_pct", "months", "gift"].includes(field)) valid = integer(value, ({ discount: 100, share_pct: 100, months: 120, gift: 100000 })[field]);
    else if (field === "reasons") valid = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 2000 && Object.entries(value).every(([k, v]) => integer(k, 2147483647, 1) && text(v, 200, true));
    else valid = text(value, ["text"].includes(field) ? 20000 : ["note", "reason"].includes(field) ? 4000 : ["target", "source_url"].includes(field) ? 2048 : 500, ["note", "reason", "contact", "account", "zone", "source_title", "source_url", "ref"].includes(field));
    if (!valid) bad("Invalid action field: " + field);
  }
  const one = (field, values) => { if (own(body, field) && body[field] !== null && !values.includes(body[field])) bad("Invalid " + field + "."); };
  one("pick", ["use", "skip", "reset"]); one("resolution", ["fixed", "kept"]);
  one("method", ["manual", "stripe"]); one("origin", ["mike", "research", "players"]);
  one("how", ["fact", "lore", "prompt", "code", "voice"]);
  if (name === "main") one("status", action === "voice-status" ? ["new", "done", "rejected"] : ["new", "done"]);
  if (name === "willo") one("status", ["new", "checked", "dismissed"]);
  if (name === "clip-resolve") one("status", ["open", "done", "kept"]);
  if (name === "translation-decide") {
    one("status", ["new", "rejected"]);
    if (own(body, "ids") === own(body, "user")) bad("Choose either ids or one translator.");
  }
  return action || name;
}
