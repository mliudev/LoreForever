// The guides editor (/guides/edit; functions/guides/edit.js, lib/guides-cms.js). Lists the articles, or edits one:
// the form on the left, the article as the site shows it on the right, updated as you type. Pictures (button, drop or
// paste) are shrunk to 1600px wide, uploaded and put in where the cursor is. Save makes it live at once.

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const msg = $("gde-msg");
const say = (text, kind = "") => { msg.textContent = text; msg.className = `gde-msg ${kind}`; msg.hidden = !text; };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", body: body instanceof Blob ? body : JSON.stringify(body),
    headers: { "Content-Type": body instanceof Blob ? body.type : "application/json" },
  });
  const data = await res.json().catch(() => ({ ok: false, error: `The site answered ${res.status}.` }));
  if (res.status === 401) {
    msg.innerHTML = "";
    msg.append("Sign in to edit guides: ");
    const a = Object.assign(document.createElement("a"), { href: "/account?next=/guides/edit", textContent: "sign in" });
    msg.append(a, ".");
    msg.hidden = false;
    throw Object.assign(new Error(data.error), { handled: true });
  }
  if (!data.ok) throw new Error(data.error || "That didn't work.");
  return data;
}

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// ---- The list ----

async function showList() {
  const { articles, editor } = await api("/api/guides");
  const rows = $("gde-rows");
  rows.replaceChildren(...articles.map(a => el("tr", {},
    el("td", {}, el("a", { href: `/guides/edit?slug=${encodeURIComponent(a.slug)}`, textContent: a.title || a.slug })),
    el("td", {}, el("span", { className: `gde-pill ${a.draft ? "draft" : "live"}`, textContent: a.draft ? "Draft" : "Published" })),
    el("td", { textContent: a.date }),
    el("td", { className: "gde-muted", textContent: a.saved_at ? `${when(a.saved_at)} by ${a.saved_by}` : "from GitHub" }),
  )));
  if (!articles.length) rows.append(el("tr", {}, el("td", { colSpan: 4, textContent: "No articles yet." })));
  say(`Signed in as ${editor}.`, "gde-muted");
  $("gde-list").hidden = false;
}

// ---- One article ----

const f = id => $(`f-${id}`);
let base = null, isNew = false, dirty = false, slugTouched = false;
const slugify = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

function fill(a) {
  for (const k of ["title", "slug", "description", "date", "author", "body"]) f(k).value = a[k] || "";
  f("kind").value = a.kind || "tutorial";
  f("draft").value = a.draft ? "1" : "0";
  f("updated").value = a.updated || "";
  count();
}

function read() {
  return { slug: f("slug").value.trim(), body: f("body").value, meta: {
    title: f("title").value, description: f("description").value, date: f("date").value, kind: f("kind").value,
    author: f("author").value, updated: f("updated").value, draft: f("draft").value === "1" } };
}

function count() {
  const n = f("description").value.length;
  $("f-desc-n").textContent = `${n}/170`;
}

function state(text) { $("gde-state").textContent = text; }

function markSaved(a) {
  base = a.saved_at;
  isNew = false;
  dirty = false;
  f("slug").readOnly = true;
  $("gde-view").href = `/guides/${a.slug}`;
  $("gde-view").hidden = false;
  $("gde-delete").hidden = false;
  state(a.saved_at ? `Saved ${when(a.saved_at)}${a.draft ? " as a draft" : ", published"}.` : "From GitHub: saving moves it to the editor.");
}

function showRevisions(list, slug) {
  $("gde-revs").replaceChildren(...list.map(r => el("li", {},
    `${when(r.saved_at)} by ${r.saved_by || "?"} (${r.draft ? "draft" : "published"}) `,
    Object.assign(el("button", { type: "button", className: "gde-link", textContent: "Load" }), { onclick: async () => {
      if (dirty && !confirm("Replace what you have with that version?")) return;
      const { article } = await api(`/api/guides?slug=${encodeURIComponent(slug)}&revision=${r.id}`);
      fill(article);
      dirty = true;
      preview();
      state(`Loaded the version from ${when(r.saved_at)}. Save to bring it back.`);
    } }))));
  if (!list.length) $("gde-revs").append(el("li", { textContent: "None yet: every save is kept here." }));
}

let timer = 0, seq = 0;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++seq;
    try {
      const { html } = await api("/api/guides", { action: "preview", ...read() });
      if (mine === seq) $("gde-pv").innerHTML = html;
    } catch (e) { if (!e.handled) state(e.message); }
  }, 400);
}

async function showArticle() {
  const form = $("gde-form");
  // The "updated" date travels with the form so a save keeps it.
  form.append(el("input", { type: "hidden", id: "f-updated" }));
  if (params.get("new")) {
    isNew = true;
    await api("/api/guides");
    fill({ date: new Date().toISOString().slice(0, 10), draft: true, kind: "tutorial" });
    state("New article: it stays a draft until you publish it.");
    showRevisions([], "");
  } else {
    const slug = params.get("slug");
    const { article, revisions } = await api(`/api/guides?slug=${encodeURIComponent(slug)}`);
    fill(article);
    markSaved(article);
    showRevisions(revisions, slug);
  }
  say("");
  form.hidden = false;
  preview();

  form.addEventListener("input", e => {
    dirty = true;
    if (e.target === f("title") && isNew && !slugTouched) f("slug").value = slugify(f("title").value);
    if (e.target === f("slug")) slugTouched = true;
    if (e.target === f("description")) count();
    preview();
  });
  form.addEventListener("change", () => { dirty = true; preview(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    $("gde-save").disabled = true;
    state("Saving…");
    try {
      const { article } = await api("/api/guides", { action: "save", ...read(), base, isNew });
      const wasNew = isNew;
      markSaved(article);
      fill(article);
      if (wasNew) history.replaceState(null, "", `/guides/edit?slug=${encodeURIComponent(article.slug)}`);
      const { revisions } = await api(`/api/guides?slug=${encodeURIComponent(article.slug)}`);
      showRevisions(revisions, article.slug);
    } catch (err) {
      if (!err.handled) state(`Not saved: ${err.message}`);
    } finally {
      $("gde-save").disabled = false;
    }
  });
  $("gde-delete").addEventListener("click", async () => {
    if (!confirm("Delete this article from the site? Its versions are kept.")) return;
    try {
      await api("/api/guides", { action: "delete", slug: f("slug").value });
      dirty = false;
      location.href = "/guides/edit";
    } catch (err) { if (!err.handled) state(err.message); }
  });
  addEventListener("beforeunload", e => { if (dirty) e.preventDefault(); });
  tools();
  pictures();
}

// ---- Formatting buttons ----

function insert(before, after = "", fallback = "") {
  const t = f("body");
  const { selectionStart: s, selectionEnd: e, value } = t;
  const sel = value.slice(s, e) || fallback;
  t.setRangeText(before + sel + after, s, e, "end");
  if (!value.slice(s, e) && fallback) t.setSelectionRange(s + before.length, s + before.length + fallback.length);
  t.focus();
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

// Puts a prefix at the start of each selected line ("## ", "- ", "> ").
function prefix(p) {
  const t = f("body");
  const start = t.value.lastIndexOf("\n", t.selectionStart - 1) + 1;
  const end = t.selectionEnd;
  const lines = t.value.slice(start, end).split("\n").map(l => p + l.replace(/^(#{1,3} |- |> )/, ""));
  t.setRangeText(lines.join("\n"), start, end, "end");
  t.focus();
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

function tools() {
  const actions = {
    h2: () => prefix("## "), h3: () => prefix("### "), ul: () => prefix("- "), quote: () => prefix("> "),
    b: () => insert("**", "**", "bold text"), i: () => insert("*", "*", "italic text"),
    link: () => insert("[", "](https://)", "link text"),
    faq: () => insert("\n## FAQ\n\n### ", "\nThe answer.\n", "A question players ask?"),
  };
  for (const b of document.querySelectorAll(".gde-tools [data-md]")) b.addEventListener("click", () => actions[b.dataset.md]());
}

// ---- Pictures ----

async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bmp.width);
  if (scale === 1 && file.size < 1_500_000) return file;
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return (await new Promise(r => c.toBlob(r, "image/webp", 0.85))) || file;
}

async function upload(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    state(`Uploading ${file.name || "the picture"}…`);
    try {
      const { url } = await api("/api/guides/image", await shrink(file));
      const alt = (file.name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "Picture";
      // Blank lines around it, so it's a picture of its own with its caption under it, not part of a paragraph.
      insert(`\n\n![${alt}](${url} "`, `")\n\n`, "Caption (or delete the quotes)");
      state("Picture added. Change the words in [ ] to describe it, for search and screen readers.");
    } catch (e) {
      if (!e.handled) state(`Picture not added: ${e.message}`);
    }
  }
}

function pictures() {
  const input = $("gde-file"), body = f("body");
  $("gde-pic").addEventListener("click", () => input.click());
  input.addEventListener("change", () => { upload([...input.files]); input.value = ""; });
  body.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); upload(files); }
  });
  body.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  body.addEventListener("drop", e => {
    const files = [...(e.dataTransfer?.files || [])].filter(x => x.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); upload(files); }
  });
}

(params.get("slug") || params.get("new") ? showArticle() : showList()).catch(e => { if (!e.handled) say(e.message, "gde-error"); });
