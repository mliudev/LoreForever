// Player feedback forwarded to Slack #player-feedback the moment it's saved (LOR-641): plain code, no AI step. Each
// source calls forwardFeedback(context, source, item) right after its row is written. The post goes out under
// waitUntil, so a save never waits on Slack or fails because of it. The once-a-day AI summary in the same channel is
// a routine's, not this. Feedback from elsewhere (hello@ mail, Discord, YouTube and CurseForge comments) comes in through
// POST /api/feedback/forward from the feedback forwarder Worker (workers/feedback) and goes out the same way.
// Pages settings (secrets; scripts/feedback-setup.mjs sets them from .env). Nothing is posted or stored until one works:
//   SLACK_FEEDBACK_WEBHOOK  a Slack incoming webhook (https://hooks.slack.com/services/...) for #player-feedback, or
//                           "log" for a dry run: each message goes to the Functions log (wrangler pages deployment
//                           tail) instead of Slack.
//   SLACK_BOT_TOKEN         or a Slack app's bot token (xoxb-..., scope chat:write; the app in the channel, or
//                           chat:write.public): posts with chat.postMessage to SLACK_FEEDBACK_CHANNEL (default
//                           #player-feedback, C0C9XBY9WQM). A working webhook is used first.
// A post carries the source, what the player said, where and which version when known, and a link to its /admin tab
// (a Discord post links to itself; mail has no link: the full message is in the inbox).
// Never an email address, account id, IP address or contact handle: emails and IP addresses typed into free text are
// masked, and a name shows only where the player chose one to be shown (a credit, feedback that's OK to quote).
// Willo's questions and answers have the account's character names taken out (lib/answer-log.js scrubNames). A
// friend report says only how many reports and messages there are, never who or what was said.
// Floods: one message per item, ever (slack_forwards' key). Past BURST items in a minute one notice says the rest
// wait, and the next forward after that minute (or flushDigest) posts them as one digest line.

import { REASONS as CLIP_REASONS } from "../public/clip-report-code.js";
import { REASONS as REPORT_REASONS } from "../public/report-code.js";
import { accountNames, scrubNames } from "./answer-log.js";

export const BURST = 20;      // item posts a minute; past this they wait for the digest
const KEEP_DAYS = 30;         // a key is kept this long, so an item edited later isn't posted again
const TEXT_MAX = 700;         // characters of what the player said, per post
const TIMEOUT_MS = 10_000;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS slack_forwards (key TEXT PRIMARY KEY, source TEXT NOT NULL, minute TEXT NOT NULL,
    state TEXT NOT NULL, created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS slack_forwards_minute ON slack_forwards (state, minute)",
];
const ready = new WeakMap();
async function setup(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

const CHANNEL = "C0C9XBY9WQM";   // #player-feedback

// How the site reaches Slack, from its two settings, never showing a value: {state, via?, ...}. state is "webhook",
// "bot token", "log", "off" (neither set), or why what's set isn't used. Either setting may hold either kind (a token
// pasted as the webhook still works). Anything but a Slack webhook or bot token is off, so a Discord URL put in by
// mistake never gets player text. Quotes or <> pasted around a value are dropped. /api/admin shows the state.
export function slackState(env) {
  const clean = v => (typeof v === "string" ? v : "").trim().replace(/^["'<\s]+|["'>\s]+$/g, "");
  const values = [clean(env?.SLACK_FEEDBACK_WEBHOOK), clean(env?.SLACK_BOT_TOKEN)].filter(Boolean);
  if (!values.length) return { state: "off" };
  if (values.includes("log")) return { state: "log", via: "log" };
  const reasons = [];
  for (const value of values) {
    if (/^xoxb-[\w-]+$/.test(value)) {
      return { state: "bot token", via: "bot", token: value, channel: clean(env.SLACK_FEEDBACK_CHANNEL) || CHANNEL };
    }
    if (/^xox[a-z]-/i.test(value)) { reasons.push("a Slack token that isn't a bot token (xoxb-)"); continue; }
    let url;
    try { url = new URL(value); } catch (e) { reasons.push("not a URL or a bot token"); continue; }
    if (url.protocol === "https:" && url.hostname === "hooks.slack.com") return { state: "webhook", via: "webhook", hook: url.href };
    reasons.push(`not a Slack incoming webhook (${url.protocol}//${url.hostname})`);
  }
  return { state: [...new Set(reasons)].join("; ") };
}

const warned = new WeakSet();   // env objects already warned about an unusable setting, so the log says it once
function target(env) {
  const slack = slackState(env);
  if (!slack.via && slack.state !== "off" && env && !warned.has(env)) {
    warned.add(env);
    console.warn(`slack feedback: a Slack setting is set but unused: ${slack.state}. It needs a Slack incoming webhook ` +
      "URL (https://hooks.slack.com/services/...) or a bot token (xoxb-...).");
  }
  return slack.via ? slack : null;
}
export const forwarding = env => Boolean(target(env) && env?.DB);

// ---- Text ----

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`\\b${OCTET}(?:\\.${OCTET}){3}\\b`, "g");
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){2,6}:(?:[0-9a-f]{1,4}\b)?/gi;
// Slack's three control characters; with < and > escaped no one can write a <!channel> or a link.
const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Player text as it's posted: no emails or IP addresses, escaped, cut to `max`.
export function plain(text, max = TEXT_MAX) {
  let s = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(EMAIL, "[email]").replace(IPV4, "[ip]").replace(IPV6, "[ip]").trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return escape(s);
}
const quote = s => s.split("\n").slice(0, 12).map(l => "> " + l).join("\n");
const one = (s, max = 120) => plain(String(s ?? "").replace(/\s+/g, " "), max);
const where = (...parts) => parts.map(p => one(p, 80)).filter(Boolean).join(" / ");
const minutes = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---- Sources ----
// Each: {icon, tab (the /admin#tab, or null), link?(item) (its own page instead), key(item), format(item) -> {title,
// text?, meta[]}}. Async formats may read D1. EXTERNAL ones come from the forwarder Worker, not the site's own saves.

const WILLO_KINDS = { flag: "Wrong answer flagged", correction: "Player corrected her", frustration: "Player frustrated" };
const DONATION = { new: "Voice lent", replaced: "Lent voice re-recorded", withdrawn: "Lent voice withdrawn" };

export const SOURCES = {
  // /feedback (functions/api/feedback.js): f is the saved row, with label (the kind's name) and report (the decoded
  // report code, or null).
  feedback: {
    icon: ":speech_balloon:", tab: "feedback", key: f => f.id,
    format: f => {
      const r = f.report;
      const filled = r && f.message === REPORT_REASONS[r.reason];
      return {
        title: `Site feedback · ${f.label}` + (f.rating ? " " + "★".repeat(f.rating) + "☆".repeat(5 - f.rating) : ""),
        text: [filled ? "" : plain(f.message), r?.question ? `Asked: "${one(r.question, 300)}"` : ""].filter(Boolean).join("\n"),
        meta: [
          r && filled ? one(REPORT_REASONS[r.reason]) : "",
          r ? where(r.zone, r.subzone) : "", r?.target ? "target " + one(r.target, 60) : "",
          r?.version ? "add-on " + one(r.version, 20) : "", r && r.locale && r.locale !== "en" ? one(r.locale, 8) : "",
          f.quote_ok && f.name ? `— ${one(f.name, 60)} (OK to quote)` : "",
        ],
      };
    },
  },
  // /translate#report (functions/api/translations/report.js). name: what they typed to be credited as.
  "translation-report": {
    icon: ":globe_with_meridians:", tab: "translations", key: r => r.id,
    format: r => ({
      title: `Bad translation · ${one(r.locale, 8)}` + (r.code ? ` · \`${one(r.code, 80).replace(/`/g, "'")}\`` : ""),
      text: [`Wrong: ${plain(r.wrong, 500)}`, r.better ? `Better: ${plain(r.better, 400)}` : ""].filter(Boolean).join("\n"),
      meta: [r.place ? "where: " + one(r.place, 120) : "", r.name ? `— ${one(r.name, 60)}` : ""],
    }),
  },
  // /translate/submit (functions/api/translations.js). Credit is the name they asked to be credited as.
  translation: {
    icon: ":globe_with_meridians:", tab: "translations", key: s => s.id,
    format: s => ({
      title: `Translation sent · ${one(s.language || s.locale, 40)}`,
      text: [s.fix ? plain(s.fix, 400) : "", s.note ? `Note: ${plain(s.note, 300)}` : ""].filter(Boolean).join("\n"),
      meta: [`credit: ${one(s.credit, 60)}`, s.link ? "files linked" : ""],
    }),
  },
  // /voices/submit and the upload page's Send (lib/submissions.js rows). Never the link, signature or contacts.
  "voice-submission": {
    icon: ":microphone:", tab: "voices", key: s => s.id,
    format: s => ({
      title: `Voice sent · ${one(s.pack, 60)}`,
      text: s.note ? plain(s.note, 400) : "",
      meta: [`credit: ${one(s.credit, 60)}`, one(s.clips, 120),
             String(s.link || "").startsWith("studio:") ? "" : "recordings in a shared folder"],
    }),
  },
  // Lent voices (lib/donate.js rows), with `kind`: new, replaced or withdrawn. One post per donation and kind.
  "voice-donation": {
    icon: ":microphone:", tab: "voices", key: d => `${d.id}:${d.kind}`,
    format: d => ({
      title: DONATION[d.kind] || DONATION.new,
      meta: d.kind === "withdrawn" ? [] : [d.credit ? `credit: ${one(d.credit, 60)}` : "",
        d.duration_ms ? `length ${minutes(d.duration_ms)}` : "", d.script ? `script ${one(d.script, 20)}` : ""],
    }),
  },
  // Clip reports (lib/clipreports.js saveReport): the report as read, with its id and whether it was signed in.
  "clip-report": {
    icon: ":loud_sound:", tab: "clip-reports", key: r => r.id,
    format: r => ({
      title: `Clip report · ${CLIP_REASONS[r.reason] || one(r.reason, 30)}`,
      text: [r.name ? `Name: ${one(r.name, 60)}` + (r.say_as ? ` → say it as "${one(r.say_as, 80)}"` : "") : "",
             r.note ? plain(r.note, 300) : ""].filter(Boolean).join("\n"),
      meta: [one(String(r.voice || "").replace(/^LoreForever_Voice_/, ""), 48) + " voice", `clip ${one(r.clip, 90)}`,
             r.version ? "add-on " + one(r.version, 20) : "", r.locale ? one(r.locale, 8) : "",
             `from the ${r.source === "addon" ? "add-on" : one(r.source, 12)}`, r.signedIn ? "signed in" : ""],
    }),
  },
  // Willo's answers (lib/answer-feedback.js logFeedback): flags, corrections and frustration. userId and names are
  // only for taking the account's character names out, never posted.
  willo: {
    icon: ":sparkles:", tab: "willo", key: w => w.id,
    format: async (w, env) => {
      let names = Array.isArray(w.names) ? w.names : [];
      try { names = [...names, ...(await accountNames(env, w.userId))]; } catch (e) {}
      const text = s => plain(scrubNames(String(s || ""), names), 400);
      return {
        title: `Willo · ${WILLO_KINDS[w.kind] || one(w.kind, 20)}`,
        text: [text(w.said), w.question ? `Asked: "${text(w.question)}"` : "",
               w.answer ? `Willo said: "${plain(scrubNames(String(w.answer), names), 300)}"` : ""].filter(Boolean).join("\n"),
        meta: [where(w.zone, w.sub), w.spoken ? "spoken" : "", w.persona && w.persona !== "willo" ? one(w.persona, 16) : "",
               w.client ? one(String(w.client).replace(/^companion\//, "Willo "), 30) : ""],
      };
    },
  },
  // Reports in Willo's friends (lib/friends.js reportPlayer): counts only.
  "friend-report": {
    icon: ":triangular_flag_on_post:", tab: "willo", key: r => r.id,
    format: r => ({
      title: "Friend report",
      text: `A player reported someone in Willo's friends. ${r.times > 1 ? `That player has ${r.times} reports now.` : "Their first report."}`,
      meta: [`${r.messages} message${r.messages === 1 ? "" : "s"} kept`, r.note ? "with a note" : ""],
    }),
  },
  // Mail to hello@ (workers/feedback): the sender's display name (never the address; none when it has only an address),
  // the subject and the start of the text, quoted replies cut. The whole message is in the inbox it was forwarded to.
  email: {
    icon: ":envelope:", tab: null, key: m => m.id,
    format: m => ({
      title: "Email to hello@" + (m.subject ? ` · ${one(m.subject, 150)}` : ""),
      text: plain(m.text, 500),
      meta: [m.name ? `from ${one(m.name, 60)}` : "from someone (no name given)",
             m.attachments > 0 ? `${Number(m.attachments)} attachment${m.attachments > 1 ? "s" : ""}` : "",
             m.forwardFailed ? ":warning: not forwarded to the inbox" : "in the inbox"],
    }),
  },
  // New posts in the Discord server's community channels (workers/feedback polls them): the channel (and thread), the
  // text and the member's display name as the server shows it. Our bots and staff are left out by the Worker.
  discord: {
    icon: ":left_speech_bubble:", tab: null, key: d => d.id,
    link: d => (DISCORD_LINK.test(String(d.url)) ? `<${d.url}|open in Discord>` : ""),
    format: d => ({
      title: `Discord #${one(d.channel, 40)}` + (d.thread ? ` › ${one(d.thread, 80)}` : ""),
      text: plain(d.text, TEXT_MAX),
      meta: [d.author ? one(d.author, 40) : "", d.reply ? "a reply" : "",
             d.attachments > 0 ? `${Number(d.attachments)} attachment${d.attachments > 1 ? "s" : ""}` : ""],
    }),
  },
  // New comments on the channel's Lore Forever videos (workers/feedback polls the YouTube Data API).
  youtube: {
    icon: ":tv:", tab: null, key: y => y.id,
    link: y => (YOUTUBE_LINK.test(String(y.url)) ? `<${y.url}|open on YouTube>` : ""),
    format: y => ({
      title: `YouTube comment · ${one(y.video, 100)}`,
      text: plain(y.text, TEXT_MAX),
      meta: [y.author ? one(y.author, 40) : "", y.reply ? "a reply" : ""],
    }),
  },
  // New comments on the Lore Forever projects, from CurseForge's own notification mail (workers/feedback). CurseForge
  // shortens long ones ("..."); the link opens the project.
  curseforge: {
    icon: ":jigsaw:", tab: null, key: c => c.id,
    link: c => (CURSEFORGE_LINK.test(String(c.url)) ? `<${c.url}|open on CurseForge>` : ""),
    format: c => ({
      title: `CurseForge comment · ${one(c.project, 80)}`,
      text: plain(c.text, TEXT_MAX),
      meta: [c.author ? one(c.author, 40) : "", c.reply ? "a reply" : "", c.when ? one(c.when, 30) : ""],
    }),
  },
};
export const EXTERNAL = ["email", "discord", "youtube", "curseforge"];
const YOUTUBE_LINK = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{6,20}&lc=[\w.-]{1,120}$/;
const CURSEFORGE_LINK = /^https:\/\/www\.curseforge\.com\/wow\/addons\/[a-z0-9-]{1,100}$/;
const DISCORD_LINK = /^https:\/\/discord\.com\/channels\/\d{1,25}\/\d{1,25}\/\d{1,25}$/;

// ---- Posting ----

const origin = request => { try { return new URL(request.url).origin; } catch (e) { return "https://loreforeverwow.com"; } };
const adminLink = (base, tab) => `<${base}/admin#${tab}|open in /admin>`;

export async function message(env, source, item, base) {
  const s = SOURCES[source];
  const { title, text, meta } = await s.format(item, env);
  return [
    `${s.icon} *${title}*`,
    text ? quote(text) : "",
    [...meta.filter(Boolean), s.link ? s.link(item) : s.tab ? adminLink(base, s.tab) : ""].filter(Boolean).join(" · "),
  ].filter(Boolean).join("\n");
}

async function post(slack, text) {
  if (slack.via === "log") { console.log(`#player-feedback (dry run, SLACK_FEEDBACK_WEBHOOK=log):\n${text}`); return; }
  if (slack.via === "bot") {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${slack.token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: slack.channel, text, unfurl_links: false, unfurl_media: false }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) console.warn(`slack feedback: chat.postMessage ${body.error || res.status}`);
    return;
  }
  const res = await fetch(slack.hook, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
  });
  if (!res.ok) console.warn(`slack feedback: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const LABELS = { feedback: "site feedback", "translation-report": "bad translations", translation: "translations",
  "voice-submission": "voice submissions", "voice-donation": "lent voices", "clip-report": "clip reports",
  willo: "Willo answers", "friend-report": "friend reports", email: "emails", discord: "Discord posts",
  youtube: "YouTube comments", curseforge: "CurseForge comments" };

// The items held back by a burst in minutes before `minute`, posted as one line. Claimed in one statement, so two
// requests never post the same ones.
async function digest(env, slack, minute, base) {
  const { results } = await env.DB.prepare(
    "UPDATE slack_forwards SET state = 'digested' WHERE state = 'held' AND minute < ? RETURNING source, minute"
  ).bind(minute).all();
  if (!results.length) return;
  const by = {};
  for (const r of results) by[r.source] = (by[r.source] || 0) + 1;
  const span = [...new Set(results.map(r => r.minute.slice(11, 16)))].sort();
  const what = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${LABELS[k] || k}`).join(", ");
  await post(slack, `:inbox_tray: *Digest: ${results.length} more item${results.length === 1 ? "" : "s"} from the burst at ` +
    `${span[0]}${span.length > 1 ? "–" + span.at(-1) : ""} UTC*\n${what} · ${adminLink(base, "community")}`);
}

async function deliver(env, slack, source, item, base, now) {
  await setup(env);
  const minute = now.toISOString().slice(0, 16);
  const key = `${source}:${SOURCES[source].key(item)}`;
  const added = await env.DB.prepare(
    "INSERT OR IGNORE INTO slack_forwards (key, source, minute, state, created) VALUES (?, ?, ?, 'new', ?)"
  ).bind(key, source, minute, now.toISOString()).run();
  if (!added.meta.changes) return;   // posted (or held) once already
  await digest(env, slack, minute, base);
  // Sent while the minute has room, else held. One statement, so a burst's requests can't all take the last place.
  const state = await env.DB.prepare(
    "UPDATE slack_forwards SET state = CASE WHEN (SELECT COUNT(*) FROM slack_forwards WHERE minute = ? AND state = 'sent') " +
    "< ? THEN 'sent' ELSE 'held' END WHERE key = ? RETURNING state"
  ).bind(minute, BURST, key).first("state");
  if (state === "sent") {
    await post(slack, await message(env, source, item, base));
  } else {
    // One notice a minute: the request that adds the minute's marker row posts it.
    const notice = await env.DB.prepare(
      "INSERT OR IGNORE INTO slack_forwards (key, source, minute, state, created) VALUES (?, 'burst', ?, 'notice', ?)"
    ).bind(`burst:${minute}`, minute, now.toISOString()).run();
    if (notice.meta.changes) await post(slack, `:rotating_light: *More than ${BURST} feedback items this minute.* The rest wait ` +
      `for one digest line, posted with the next item after this minute. ${adminLink(base, "community")}`);
  }
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM slack_forwards WHERE created < ?")
      .bind(new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString()).run();
  }
}

// Forwards one saved item. Never throws and never waits: the post runs under waitUntil (or on its own, without one).
// context: the Pages context ({request, env, waitUntil}); `now` is for tests.
export function forwardFeedback(context, source, item, { now = new Date() } = {}) {
  return forwardAll(context, source, [item], { now });
}

// Several items of one source, posted one after another in their order (a poll's new messages).
export function forwardAll(context, source, items, { now = new Date() } = {}) {
  try {
    const env = context?.env, slack = target(env);
    items = (Array.isArray(items) ? items : []).filter(i => i && typeof i === "object");
    if (!slack || !env.DB || !SOURCES[source] || !items.length) return;
    const base = origin(context.request);
    const warn = e => console.warn(`slack feedback (${source}): ${e?.message || e}`);
    const job = (async () => {
      for (const item of items) await deliver(env, slack, source, item, base, now).catch(warn);   // one bad item skips only itself
    })();
    if (typeof context.waitUntil === "function") context.waitUntil(job);
    return job;
  } catch (e) {
    console.warn(`slack feedback (${source}): ${e?.message || e}`);
  }
}

// Posts the digest of a burst that ended with no item after it. For a scheduled caller or /admin; never throws.
export async function flushDigest(env, base = "https://loreforeverwow.com", now = new Date()) {
  const slack = target(env);
  if (!slack || !env.DB) return;
  try {
    await setup(env);
    await digest(env, slack, now.toISOString().slice(0, 16), base);
  } catch (e) {
    console.warn(`slack feedback digest: ${e?.message || e}`);
  }
}
