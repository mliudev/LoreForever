// The "upload a zip or folder" box on /voices/studio and /translate/dashboard (LOR-121). Drop a zip, a folder or many
// files; the browser unpacks and checks everything, shows what saving would do (new / replaced / unchanged / unknown
// names / older text / failed checks), and only then saves, one line or a batch of strings at a time, with progress.
// If saving stops (connection, a limit), Resume carries on from where it stopped; dropping the same zip again later
// shows what's already saved as unchanged. The logic with no page in it is in bulk-core.js.
//
// Voices: const box = voiceUpload(ctx); then box.mount(element) after every redraw of the page (studio.js).
// Kits:   const box = kitUpload(ctx);   box.mount(element) once; box.reset() when the language changes (dashboard).

import { gather, matchVoice, voiceStatus, readKit, kitSections, planKit, LIMITS, AUDIO, ZipError } from "./bulk-core.js";
import { crc32, crcHex } from "../voices/crc32.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, one, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const SHOW = 60;   // rows listed per group in the preview

const CSS = `
.bu { margin: 0 0 20px; border: 1px solid var(--line, #3a3128); border-radius: 6px; padding: 12px 14px; background: #0f0d0a; }
.bu h2 { margin: 0 0 6px; font-size: 1.1rem; }
.bu p { margin: 6px 0; color: var(--muted, #a39683); font-size: 0.9rem; max-width: 76ch; }
.bu-drop { border: 2px dashed #6b5a3a; border-radius: 8px; padding: 16px; text-align: center; margin-top: 8px; }
.bu-drop.hot { border-color: var(--gold, #ffd100); background: #1a150b; }
.bu-drop strong { display: block; font-family: var(--heading, serif); color: var(--gold-soft, #d8b25a); margin-bottom: 6px; }
.bu-b { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--panel-line, #5b5f6e); background: #12152a; color: var(--text, #e8e0d2); font: inherit; font-size: 0.9rem; cursor: pointer; margin: 2px; }
.bu-b:hover { border-color: var(--gold-soft, #d8b25a); }
.bu-b:disabled { opacity: 0.6; cursor: default; }
.bu-b.main { background: #3b2a0e; border-color: var(--gold-soft, #d8b25a); font-weight: 600; }
.bu-b:focus-visible { outline: 2px solid var(--gold, #ffd100); outline-offset: 2px; }
.bu-cats { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 4px; }
.bu-cats details summary { cursor: pointer; }
.bu-cats ul { margin: 6px 0 8px; padding-left: 18px; font-size: 0.85rem; color: var(--muted, #a39683); max-height: 320px; overflow: auto; }
.bu-cats li li { margin: 2px 0; overflow-wrap: anywhere; }
.bu-n { display: inline-block; min-width: 3.2em; font-weight: 700; }
.bu-new .bu-n { color: #6fcf6f; } .bu-replaced .bu-n { color: var(--gold-soft, #d8b25a); }
.bu-unknown .bu-n, .bu-failed .bu-n { color: #e5534b; } .bu-stale .bu-n { color: #b98ad0; } .bu-unchanged .bu-n { color: var(--muted, #a39683); }
.bu-warn { color: #f0a33a; } .bu-bad { color: #e5534b; } .bu-ok { color: #6fcf6f; }
.bu-file { font-family: ui-monospace, Consolas, monospace; font-size: 0.85em; }
.bu-track { height: 8px; background: #1c2031; border-radius: 4px; overflow: hidden; margin: 8px 0; }
.bu-track i { display: block; height: 100%; background: var(--gold-soft, #d8b25a); transition: width 0.2s; }
.bu label { cursor: pointer; }
`;
let styled = false;
function style() {
  if (styled) return;
  styled = true;
  document.head.append(Object.assign(document.createElement("style"), { textContent: CSS }));
  // A file dropped next to the box would open in the tab instead.
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => e.preventDefault());
}

// ---- Getting the files ----

// Dropped files and folders as [{name: path, size, blob}].
async function fromDrop(dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files].map(f => ({ name: f.name, size: f.size, blob: f }));
  const out = [];
  const walk = async entry => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ name: entry.fullPath.replace(/^\//, ""), size: f.size, blob: f });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

function choose({ folder = false, accept = "" } = {}) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept) input.accept = accept;
    if (folder) input.webkitdirectory = true;
    input.addEventListener("change", () => resolve([...input.files].map(f => ({ name: f.webkitRelativePath || f.name, size: f.size, blob: f }))));
    input.click();
  });
}

// ---- The box (shared by both pages) ----

class Box {
  constructor(kind) {
    style();
    this.kind = kind;
    this.el = null;
    this.phase = "idle";   // idle, reading, preview, saving, paused, done
    this.error = null;
  }

  mount(el) {
    this.el = el;
    if (!el) return;
    el.classList.add("bu");
    if (!el.dataset.buBound) {
      el.dataset.buBound = "1";
      el.addEventListener("click", e => this.click(e));
      el.addEventListener("change", e => this.change(e));
      el.addEventListener("dragover", e => { if (this.canDrop()) { e.preventDefault(); el.querySelector(".bu-drop")?.classList.add("hot"); } });
      el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.querySelector(".bu-drop")?.classList.remove("hot"); });
      el.addEventListener("drop", async e => {
        e.preventDefault();
        if (!this.canDrop()) return;
        this.take(await fromDrop(e.dataTransfer));
      });
    }
    this.draw();
  }

  canDrop() { return ["idle", "preview", "done"].includes(this.phase); }

  draw() {
    if (!this.el) return;
    this.el.innerHTML = this.html();
  }

  dropHtml(what, accept) {
    return `<div class="bu-drop"><strong>Drop ${what} here</strong>
      <button class="bu-b" type="button" data-bu="zip" data-accept="${esc(accept)}">Choose a zip or files</button>
      <button class="bu-b" type="button" data-bu="folder">Choose a folder</button></div>`;
  }

  progressHtml(done, total, label) {
    return `<div class="bu-track" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
      <i style="width:${total ? ((done / total) * 100).toFixed(1) : 0}%"></i></div><p role="status">${label}</p>`;
  }

  async click(e) {
    const b = e.target.closest("[data-bu]");
    if (!b) return;
    const act = b.dataset.bu;
    if (act === "zip") this.take(await choose({ accept: b.dataset.accept }));
    else if (act === "folder") this.take(await choose({ folder: true }));
    else if (act === "cancel" || act === "again") { this.phase = "idle"; this.error = null; this.draw(); }
    else if (act === "save" || act === "resume") this.save();
  }

  change() {}

  async take(sources) {
    if (!sources.length) return;
    this.phase = "reading";
    this.error = null;
    this.reading = { done: 0, total: 0, name: "" };
    this.draw();
    try {
      const { files, ignored } = await gather(sources, this.kind);
      this.source = sources.length === 1 ? sources[0].name.split("/").pop() : sources[0].name.includes("/") ? sources[0].name.split("/")[0] : plural(sources.length, "file");
      await this.plan(files, ignored);
      this.phase = "preview";
    } catch (err) {
      this.phase = "idle";
      this.error = err instanceof ZipError ? err.message : "Couldn't read that. Try again, or make a new .zip of the folder.";
      if (!(err instanceof ZipError)) console.error(err);
    }
    this.draw();
  }

  // Saving: runs jobs (one per line, or one per batch of strings) a few at a time. A job resolves to "done", "failed"
  // (that item only; the rest go on) or "stop" (pause everything: no connection, a daily limit). A 429 with retryAfter
  // waits and goes on by itself.
  async save() {
    if (this.phase === "saving") return;
    this.phase = "saving";
    this.pauseReason = null;
    this.draw();
    const queue = this.jobs.filter(j => j.state !== "done" && j.state !== "failed");
    let stop = false;
    const worker = async () => {
      while (!stop && queue.length) {
        const job = queue.shift();
        for (let tries = 0; ; tries++) {
          const r = await this.run(job);
          if (r.retryAfter) { this.waiting = r.retryAfter; this.draw(); await wait(r.retryAfter * 1000); this.waiting = 0; continue; }
          if (r.network && tries < 2) { await wait(2000 * (tries + 1)); continue; }
          if (r.network || r.stop) { stop = true; job.state = "todo"; this.pauseReason = r.error; queue.unshift(job); }
          else if (r.error) { job.state = "failed"; job.error = r.error; }
          else job.state = "done";
          break;
        }
        this.draw();
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));
    this.phase = stop ? "paused" : "done";
    this.saved();
    this.draw();
  }

  savingHtml() {
    const total = this.jobs.length, done = this.jobs.filter(j => j.state === "done").length;
    const failed = this.jobs.filter(j => j.state === "failed");
    const unit = this.unit;
    let out = "";
    if (this.phase === "saving") {
      out += this.progressHtml(done + failed.length, total, this.waiting
        ? `Saved ${done} of ${plural(total, unit)}. Going a little fast: carrying on in ${this.waiting} s...`
        : `Saving... ${done} of ${plural(total, unit)} saved. You can keep using the page; don't close it until this is done.`);
    } else if (this.phase === "paused") {
      out += this.progressHtml(done, total, `Saved ${done} of ${plural(total, unit)}, then stopped: ${esc(this.pauseReason || "the connection dropped")}`);
      out += `<p><button class="bu-b main" type="button" data-bu="resume">Resume</button>
        <button class="bu-b" type="button" data-bu="cancel">Stop here</button></p>
        <p>Resume carries on with the ${plural(total - done - failed.length, unit)} not saved yet. If you leave the page, drop the same
          files again later: what's already saved shows as unchanged.</p>`;
    } else {
      out += `<p class="bu-ok" role="status">Saved ${plural(done, unit)}.${failed.length ? "" : " All done."}</p>`;
    }
    if (failed.length) {
      out += `<p class="bu-bad">${plural(failed.length, unit)} couldn't be saved:</p><ul class="bu-bad">${failed.slice(0, SHOW)
        .map(j => `<li>${this.jobLabel(j)}: ${esc(j.error)}</li>`).join("")}${failed.length > SHOW ? `<li>and ${failed.length - SHOW} more</li>` : ""}</ul>`;
    }
    if (this.phase === "done") out += `<p><button class="bu-b" type="button" data-bu="again">Upload more</button></p>`;
    return out;
  }

  // One preview group: <li> with a count and, when there's something to list, the list.
  group(cls, n, label, rows, rowHtml, open = false) {
    if (!n) return "";
    const list = rows.length ? `<ul>${rows.slice(0, SHOW).map(rowHtml).join("")}${rows.length > SHOW ? `<li>and ${rows.length - SHOW} more</li>` : ""}</ul>` : "";
    return `<li class="bu-${cls}">${list ? `<details${open ? " open" : ""}><summary>` : ""}<span class="bu-n">${n.toLocaleString("en-US")}</span> ${label}${list ? `</summary>${list}</details>` : ""}</li>`;
  }
}

// ---- Voices (/voices/studio) ----
// ctx: voice() {id, name, locale}; languageName(); items() [{id, file, hash, name, q, target}] for the voice's
// language; takes() {line id: take}; maxBytes (one file, after converting); analyze(file, item) and
// warningText(key, checks, item) from studio.js; onTake(voice id, line id, take) after each saved line.

class VoiceBox extends Box {
  constructor(ctx) {
    super("voice");
    this.ctx = ctx;
    this.unit = "line";
    this.concurrency = 2;
  }

  html() {
    if (this.voiceId && this.voiceId !== this.ctx.voice().id && !["saving", "paused"].includes(this.phase)) { this.phase = "idle"; this.voiceId = null; }
    const head = `<h2>Upload many recordings at once</h2>`;
    if (this.phase === "idle") {
      return `${head}<p>Drop a zip or a folder of your recordings, named as in the <a href="/voices/clips.csv" download>clip list</a>
        (for example <span class="bu-file">zone_stormwind.mp3</span> and <span class="bu-file">zone_stormwind__faq3.wav</span>),
        or a test pack you downloaded here. Each file goes to its line. You'll see what changes before anything is saved.</p>
        ${this.dropHtml("a zip, a folder or files", ".zip,.mp3,.m4a,.ogg,.opus,.wav,.flac,.aac,.webm,audio/*")}
        ${this.error ? `<p class="bu-bad" role="alert">${esc(this.error)}</p>` : ""}`;
    }
    if (this.phase === "reading") {
      const r = this.reading;
      return `${head}${this.progressHtml(r.done, r.total, r.total ? `Checking ${r.done + 1} of ${r.total}: <span class="bu-file">${esc(r.name)}</span>` : "Opening...")}`;
    }
    if (this.phase === "preview") return head + this.previewHtml();
    return head + this.savingHtml();
  }

  async plan(files, ignored) {
    const v = this.ctx.voice();
    this.voiceId = v.id;
    const items = this.ctx.items();
    const m = await matchVoice(files, items);
    const takes = this.ctx.takes();
    const p = { new: [], replaced: [], unchanged: [], unknown: m.unknown, stale: m.stale, failed: [], other: m.other + ignored.length, pack: m.pack };
    this.reading.total = m.rows.length;
    for (const [i, row] of m.rows.entries()) {
      this.reading.done = i;
      this.reading.name = row.path.split("/").pop();
      this.draw();
      let a;
      try {
        const bytes = await row.read();
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        a = await this.ctx.analyze({ name: this.reading.name, size: buf.byteLength, arrayBuffer: async () => buf }, row.it);
      } catch (err) {
        a = { error: err instanceof ZipError ? err.message : "Couldn't read this file." };
      }
      if (!a.error && a.buf.byteLength > this.ctx.maxBytes) a.error = `Over ${this.ctx.maxBytes / 1048576} MB. Export it as .mp3 or .ogg to make it smaller.`;
      if (a.error) { p.failed.push({ path: row.path, it: row.it, why: a.error }); continue; }
      const status = voiceStatus(takes[row.it.id], a.buf, row.hash);
      p[status].push({ path: row.path, it: row.it, hash: row.hash, buf: status === "unchanged" ? null : a.buf, checks: a.checks, pick: true });
    }
    this.p = p;
  }

  lineName(it) { return `${esc(it.name)}${it.q ? `: ${esc(it.q)}` : ""}`; }

  previewHtml() {
    const p = this.p, lang = esc(this.ctx.languageName());
    const fname = path => `<span class="bu-file">${esc(path.split("/").pop())}</span>`;
    const warn = r => r.checks?.warnings?.length ? ` <span class="bu-warn">${esc(this.ctx.warningText(r.checks.warnings[0], r.checks, r.it))}</span>` : "";
    const pickRow = (r, i, cat) => `<li><label><input type="checkbox" data-bu-pick="${cat}:${i}"${r.pick ? " checked" : ""}> ${fname(r.path)} → ${this.lineName(r.it)}</label>${warn(r)}</li>`;
    const picked = [...p.new, ...p.replaced].filter(r => r.pick).length;
    const unknownWhy = u => u.why === "name"
      ? `${fname(u.path)} doesn't match a line name${u.suggest ? `. Did you mean <span class="bu-file">${esc(u.suggest)}</span>? Rename it and drop it again` : ""}`
      : u.why === "notext" ? `${fname(u.path)}: ${this.lineName(u.it)} has no ${lang} text yet`
      : `${fname(u.path)}: another file in this upload is already for ${this.lineName(u.it)}`;
    const warned = [...p.new, ...p.replaced].filter(r => r.checks?.warnings?.length).length;
    return `<p>${esc(this.source)}${p.pack ? " (a test pack)" : ""}: here's what saving would do. Only these lines change; every other line stays as it is.</p>
      <ul class="bu-cats">
        ${this.group("new", p.new.length, "new lines", p.new, (r, i) => pickRow(r, i, "new"), true)}
        ${this.group("replaced", p.replaced.length, "replace a recording you uploaded before", p.replaced, (r, i) => pickRow(r, i, "replaced"), true)}
        ${this.group("unchanged", p.unchanged.length, "already saved, unchanged", p.unchanged, r => `<li>${fname(r.path)} → ${this.lineName(r.it)}</li>`)}
        ${this.group("unknown", p.unknown.length, "with names we can't place", p.unknown, u => `<li>${unknownWhy(u)}</li>`, true)}
        ${this.group("stale", p.stale.length, "recorded against older text (we reworded these lines since; record the new text and drop that file on its own)", p.stale, r => `<li>${fname(r.path)} → ${this.lineName(r.it)}</li>`, true)}
        ${this.group("failed", p.failed.length, "failed the checks", p.failed, r => `<li>${fname(r.path)}: ${esc(r.why)}</li>`, true)}
      </ul>
      ${p.other ? `<p>${plural(p.other, "other file")} (text, Lua, TOC and so on) ${p.other === 1 ? "was" : "were"} left out. We only take the recordings.</p>` : ""}
      ${warned ? `<p class="bu-warn">${plural(warned, "recording")} ${warned === 1 ? "needs" : "need"} a look (shown above). You can save them anyway.</p>` : ""}
      <p>${picked ? `<button class="bu-b main" type="button" data-bu="save">Save ${plural(picked, "line")}</button>` : "<span>Nothing to save.</span>"}
        <button class="bu-b" type="button" data-bu="cancel">Cancel</button></p>`;
  }

  change(e) {
    const t = e.target.closest("[data-bu-pick]");
    if (!t) return;
    const [cat, i] = t.dataset.buPick.split(":");
    this.p[cat][Number(i)].pick = t.checked;
    this.draw();
  }

  async save() {
    if (this.phase === "preview") {
      // The plan was made for one voice: if the page moved to another meanwhile, start over.
      if (this.voiceId !== this.ctx.voice()?.id) { this.phase = "idle"; this.error = "You switched voices. Drop the files again."; this.draw(); return; }
      this.jobs = [...this.p.new, ...this.p.replaced].filter(r => r.pick).map(r => ({ row: r, state: "todo" }));
      if (!this.jobs.length) return;
    }
    return super.save();
  }

  jobLabel(j) { return `<span class="bu-file">${esc(j.row.path.split("/").pop())}</span>`; }

  async run(job) {
    const { row } = job, voice = this.voiceId;   // the voice the plan was made for, even if the page switched since
    const crc = crcHex(crc32(new Uint8Array(row.buf)));
    let r;
    try {
      r = await fetch(`/api/studio/take?voice=${encodeURIComponent(voice)}&line=${encodeURIComponent(row.it.id)}`, {
        method: "PUT", body: new Blob([row.buf]), cache: "no-store",
        headers: { "X-File-Name": encodeURIComponent(row.path.split("/").pop().slice(0, 120)),
                   "X-Checks": encodeURIComponent(JSON.stringify(row.checks)), "X-CRC32": crc, "X-Text-Hash": row.hash },
      });
    } catch (e) {
      return { network: true, error: "couldn't reach the server" };
    }
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) {
      row.buf = null;
      this.ctx.onTake(voice, row.it.id, { ...body.take, crc32: crc });
      return {};
    }
    if (r.status === 429 && body.retryAfter) return { retryAfter: Math.min(60, Math.max(1, Number(body.retryAfter))) };
    if (r.status === 429 || r.status === 413 && /out of space/.test(body.error || "") || r.status === 401 || r.status === 403) return { stop: true, error: body.error || `the server answered ${r.status}` };
    if (r.status >= 500) return { network: true, error: body.error || `the server answered ${r.status}` };
    return { error: body.error || `The server answered ${r.status}.` };
  }

  saved() {}
}

// ---- Translation kits (/translate/dashboard) ----
// ctx: locale(); languageName(); entrySection {entry key: section id}; hasText(); mine() {string id: {text, status}};
// onSaved() after saving (the page reloads your edits).

class KitBox extends Box {
  constructor(ctx) {
    super("kit");
    this.ctx = ctx;
    this.unit = "string";
    this.concurrency = 1;
    this.replace = true;
  }

  reset() { if (this.phase !== "saving") { this.phase = "idle"; this.error = null; this.draw(); } }

  html() {
    const head = `<h2>Upload your edited kit</h2>`;
    if (this.phase === "idle") {
      return `${head}<p>Translated offline? Drop your kit here: the zip, its folder, or just the .json files you changed.
        Each string you filled in or changed is saved as your edit, as if you'd typed it here. Strings whose English changed
        since you downloaded the kit are skipped and listed. You'll see what changes before anything is saved.</p>
        ${this.dropHtml("your kit (.zip, folder or .json files)", ".zip,.json")}
        ${this.error ? `<p class="bu-bad" role="alert">${esc(this.error)}</p>` : ""}`;
    }
    if (this.phase === "reading") return `${head}${this.progressHtml(0, 1, "Reading your kit...")}`;
    if (this.phase === "preview") return head + this.previewHtml();
    return head + this.savingHtml();
  }

  async plan(files, ignored) {
    const locale = this.ctx.locale();
    this.locale = locale;
    const kit = await readKit(files);
    if (kit.langtest && !kit.rows.size) {
      throw new ZipError("That's a test pack. The edits in it are already saved here, so there's nothing to upload. Drop the kit's .json files instead.");
    }
    if (!kit.rows.size) throw new ZipError("No kit strings in that. Drop the kit zip, its folder, or the .json files from it.");
    if (kit.meta?.locale && kit.meta.locale !== locale) {
      throw new ZipError(`That's the ${kit.meta.language || kit.meta.locale} kit. Pick ${kit.meta.language || kit.meta.locale} under Language above, then drop it again.`);
    }
    const sids = kitSections(kit.rows, this.ctx.entrySection);
    const english = {}, published = {};
    const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); };
    await Promise.all(sids.map(async sid => {
      const [en, text] = await Promise.all([
        get(`/translate/data/en/${sid}.json`),
        this.ctx.hasText() ? get(`/translate/data/${locale}/${sid}.json`).catch(() => ({})) : {},
      ]);
      for (const [id, s] of en.strings || []) english[id] = s;
      Object.assign(published, text);
    }));
    const mine = {};
    for (const [id, e] of Object.entries(this.ctx.mine())) if (e.status === "new" || e.status === "accepted") mine[id] = e.text;
    this.p = { ...planKit(kit.rows, { english, published, mine, entrySection: this.ctx.entrySection }),
               problems: kit.problems, other: kit.other + ignored.length, langtest: kit.langtest };
  }

  previewHtml() {
    const p = this.p, lang = esc(this.ctx.languageName());
    const snip = s => esc(s.length > 90 ? s.slice(0, 90) + "..." : s);
    const row = r => `<li><span class="bu-file">${esc(r.id)}</span>: ${snip(r.text)}</li>`;
    const n = p.new.length + (this.replace ? p.replaced.length : 0);
    return `<p>${esc(this.source)}: here's what saving would do in ${lang}. Only these strings change.</p>
      <ul class="bu-cats">
        ${this.group("new", p.new.length, "new: no text in this language yet", p.new, row, false)}
        ${this.group("replaced", p.replaced.length, "change text that's there now (or your saved edit)", p.replaced,
          r => `<li><span class="bu-file">${esc(r.id)}</span>: ${snip(r.before)} → ${snip(r.text)}</li>`, false)}
        ${this.group("unchanged", p.unchanged.length, "the same as now, skipped", [], row)}
        ${this.group("unknown", p.unknown.length, "with ids that aren't ours, skipped", p.unknown, row, true)}
        ${this.group("stale", p.stale.length, "skipped: the English changed since the kit was made (they stay English until translated again)", p.stale,
          r => `<li><span class="bu-file">${esc(r.id)}</span></li>`, true)}
        ${this.group("failed", p.failed.length + p.problems.length, "failed the checks", [...p.failed, ...p.problems],
          r => r.id ? `<li><span class="bu-file">${esc(r.id)}</span>: ${esc(r.why)}</li>` : `<li><span class="bu-file">${esc(r.path)}</span> ${esc(r.why)}</li>`, true)}
      </ul>
      ${p.empty ? `<p>${plural(p.empty, "string")} left empty in the kit, skipped.</p>` : ""}
      ${p.langtest ? `<p>A test pack in there was left out: its edits are already saved.</p>` : ""}
      ${p.other ? `<p>${plural(p.other, "other file")} left out. We only read the kit's .json files.</p>` : ""}
      ${p.replaced.length ? `<p><label><input type="checkbox" data-replace${this.replace ? " checked" : ""}> Also change the ${plural(p.replaced.length, "string")} that already have text</label></p>` : ""}
      <p>${n ? `<button class="bu-b main" type="button" data-bu="save">Save ${plural(n, "string")} as my edits</button>` : "<span>Nothing to save.</span>"}
        <button class="bu-b" type="button" data-bu="cancel">Cancel</button></p>`;
  }

  change(e) {
    if (e.target.matches("[data-replace]")) { this.replace = e.target.checked; this.draw(); }
  }

  async save() {
    if (this.phase === "preview") {
      if (this.locale !== this.ctx.locale()) { this.phase = "idle"; this.error = "The language changed. Drop the kit again."; this.draw(); return; }
      const rows = [...this.p.new, ...(this.replace ? this.p.replaced : [])];
      this.jobs = [];
      for (let i = 0; i < rows.length; i += 200) this.jobs.push({ rows: rows.slice(i, i + 200), state: "todo" });
      if (!this.jobs.length) return;
    }
    return super.save();
  }

  savingHtml() {
    // Jobs are batches; count strings for people.
    const strings = state => this.jobs.filter(j => j.state === state).reduce((n, j) => n + (j.ok ?? j.rows.length), 0);
    const total = this.jobs.reduce((n, j) => n + j.rows.length, 0), done = strings("done");
    const failed = this.jobs.flatMap(j => j.failed || []);
    let out = "";
    if (this.phase === "saving") {
      out += this.progressHtml(done, total, this.waiting ? `Saved ${done.toLocaleString("en-US")} of ${plural(total, "string")}. Carrying on in ${this.waiting} s...`
        : `Saving... ${done.toLocaleString("en-US")} of ${plural(total, "string")} saved. Don't close the page until this is done.`);
    } else if (this.phase === "paused") {
      out += this.progressHtml(done, total, `Saved ${done.toLocaleString("en-US")} of ${plural(total, "string")}, then stopped: ${esc(this.pauseReason || "the connection dropped")}`);
      out += `<p><button class="bu-b main" type="button" data-bu="resume">Resume</button> <button class="bu-b" type="button" data-bu="cancel">Stop here</button></p>
        <p>Resume carries on with what isn't saved yet. If you leave the page, drop the kit again later: what's already saved shows as unchanged.</p>`;
    } else {
      out += `<p class="bu-ok" role="status">Saved ${plural(done, "string")} as your edits. They're in your test pack and the next language update.</p>`;
    }
    if (failed.length) {
      out += `<p class="bu-bad">${plural(failed.length, "string")} couldn't be saved:</p><ul class="bu-bad">${failed.slice(0, SHOW)
        .map(f => `<li><span class="bu-file">${esc(f.id)}</span>: ${esc(f.error)}</li>`).join("")}${failed.length > SHOW ? `<li>and ${failed.length - SHOW} more</li>` : ""}</ul>`;
    }
    if (this.phase === "done") out += `<p><button class="bu-b" type="button" data-bu="again">Upload more</button></p>`;
    return out;
  }

  async run(job) {
    let r;
    try {
      r = await fetch("/api/translations/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ locale: this.locale, edits: job.rows.map(({ id, en, text }) => ({ id, en, text })) }),
      });
    } catch (e) {
      return { network: true, error: "couldn't reach the server" };
    }
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) {
      job.failed = (body.results || []).filter(x => x.error);
      job.ok = body.saved;
      if (body.capped) {   // the daily limit: what went in counts as done, the rest waits for Resume tomorrow
        const left = new Set(job.failed.filter(f => f.capped).map(f => f.id));
        this.jobs.push({ rows: job.rows.filter(x => !left.has(x.id)), state: "done", ok: body.saved, failed: job.failed.filter(f => !f.capped) });
        job.rows = job.rows.filter(x => left.has(x.id));
        job.failed = [];
        job.ok = undefined;
        return { stop: true, error: "that's the most edits we take in one day. Drop the kit again tomorrow to save the rest." };
      }
      return {};
    }
    if (r.status === 429 && body.retryAfter) return { retryAfter: Math.min(60, Math.max(1, Number(body.retryAfter))) };
    if (r.status >= 500) return { network: true, error: body.error || `the server answered ${r.status}` };
    return { stop: true, error: body.error || `the server answered ${r.status}` };
  }

  saved() { this.ctx.onSaved(); }
}

export const voiceUpload = ctx => new VoiceBox(ctx);
export const kitUpload = ctx => new KitBox(ctx);
export { AUDIO };
