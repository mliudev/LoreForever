// Report codes from the add-on's "Copy report" (LOR-120), shared by /feedback (a preview of what's sent) and
// functions/api/feedback.js and admin.js (stored next to the report, posted to Discord, shown in /admin).
// The add-on writes them in Log.ReportCode (addon/LoreForever/Log.lua): keep the two in step. Fields, split by ~:
//   LF1 ~ add-on version[.locale] ~ reason ~ via+shown ~ entry key[.f<faq>|.s<section>] ~ score ~ zone[/subzone]
//       ~ target ~ quest ids (comma-separated) ~ question (spaces as _)

export const REASONS = { w: "Wrong answer", a: "Didn't answer the question", s: "Spoiler", f: "Future lore",
  o: "Something else", "-": "No reason picked" };
const VIA = { t: "typed in the panel", s: "typed after /lore", h: "Lore key over an NPC", q: "quest button",
  n: "suggested question", c: "type-ahead pick", r: "spoiler revealed", p: "dungeon primer", l: "chat link", o: "other" };
const SHOWN = { a: "answer", g: "\"did you mean\" list", n: "\"no lore on that yet\"", p: "spoiler warning" };

// The code in whatever was pasted: the bare code, the whole feedback link, or a Discord message around either.
export function findCode(text) {
  let s = String(text ?? "").trim();
  if (/[?&]code=/.test(s)) {
    try {
      const url = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s.replace(/^\/+/, ""));
      s = url.searchParams.get("code") || s;
    } catch (e) {}
  }
  if (/%[0-9a-f]{2}/i.test(s)) {
    try { s = decodeURIComponent(s); } catch (e) {}
  }
  const m = s.match(/LF1~[^\s"'`<>]*/);
  return m ? m[0] : null;
}

// The decoded report, or null when there's no report code in `text`.
export function decodeReport(text) {
  const code = findCode(text);
  if (!code) return null;
  const f = code.split("~");
  if (f.length < 10) return null;
  const question = f.slice(9).join(" ").replace(/_/g, " ").trim();
  const [, version, locale] = f[1].match(/^(.*?)(?:\.([a-z]{2}))?$/);
  const answer = f[4] === "-" || !f[4] ? null : f[4].match(/^(.+?)(?:\.([fs])(\d+))?$/);
  const [zone, ...sub] = f[6].split("/");
  const score = /^\d+$/.test(f[5]) ? Number(f[5]) : null;
  return {
    code,
    version: version || null,
    locale: locale || "en",
    reason: REASONS[f[2]] ? f[2] : "-",
    via: f[3][0] || "o",
    shown: f[3][1] || "a",
    key: answer ? answer[1] : null,
    faq: answer && answer[2] === "f" ? Number(answer[3]) : null,
    section: answer && answer[2] === "s" ? Number(answer[3]) : null,
    score,
    zone: zone || null,
    subzone: sub.join("/") || null,
    target: f[7] || null,
    quests: f[8] ? f[8].split(",").filter(q => /^\d+$/.test(q)).map(Number) : [],
    question,
  };
}

// The report in a few readable lines (plain text; Discord and /admin add their own formatting).
export function describeReport(r) {
  if (!r) return [];
  const shown = r.key
    ? (r.shown === "a" ? "" : (SHOWN[r.shown] || r.shown) + ", closest match ") + r.key
      + (r.faq ? ", FAQ " + r.faq : r.section ? ", section " + r.section : "")
      + (r.score !== null ? " (score " + r.score + ")" : "")
    : SHOWN[r.shown] || "nothing";
  return [
    "Reason: " + (REASONS[r.reason] || r.reason),
    "Question: \"" + r.question + "\" (" + (VIA[r.via] || r.via) + ")",
    "Shown: " + shown,
    "Where: " + [r.zone, r.subzone].filter(Boolean).join(" / ") + (r.target ? " · target " + r.target : ""),
    r.quests.length ? "Quests: " + r.quests.join(", ") : null,
    "Add-on " + (r.version || "?") + (r.locale !== "en" ? " · language " + r.locale : ""),
  ].filter(Boolean);
}
