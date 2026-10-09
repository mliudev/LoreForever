import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const script = readFileSync(new URL("../public/voices-page.js", import.meta.url), "utf8");

// Small DOM double: selectors, event listeners and hidden state exercise the actual browser script.
class Element {
  constructor({ id = "", classes = [], dataset = {}, text = "", hidden = false } = {}) {
    Object.assign(this, { id, dataset, textContent: text, hidden, value: "", children: [], events: {}, parent: null, attributes: {}, scrolled: false });
    this.classes = new Set(classes);
    this.classList = { contains: name => this.classes.has(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  matches(selector) {
    if (selector === ".dl-size[data-asset]") return this.classes.has("dl-size") && Object.hasOwn(this.dataset, "asset");
    if (selector === ".dl-size[data-assets]") return this.classes.has("dl-size") && Object.hasOwn(this.dataset, "assets");
    if (selector === "[data-preferred]") return Object.hasOwn(this.dataset, "preferred");
    if (selector === "[data-preferred-link]") return Object.hasOwn(this.dataset, "preferredLink");
    if (selector === "audio") return this.tagName === "audio";
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    return selector === "[data-recording]" ? Object.hasOwn(this.dataset, "recording") : selector === "[data-latest-version]" ? Object.hasOwn(this.dataset, "latestVersion") : false;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  get parentElement() { return this.parent; }
  get previousElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) - 1] || null; }
  addEventListener(event, callback) { (this.events[event] ||= []).push(callback); }
  fire(event) { for (const callback of this.events[event] || []) callback({ target: this }); }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  scrollIntoView() { this.scrolled = true; }
}

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function setup({ data = null, ok = true, reject = false, hash = "", withRows = true, withPreferred = false, aggregates = [] } = {}) {
  const document = new Element();
  document.createElement = () => new Element();
  document.getElementById = id => {
    const find = element => element.id === id ? element : element.children.map(find).find(Boolean);
    return find(document) || null;
  };
  const window = new Element(), location = { hash }, calls = [];
  const add = options => document.appendChild(new Element(options));
  const sizes = ["latest:LoreForever.zip", "v0.8.0:Voice.zip", "latest:missing.zip", "latest:bad.zip"].map(asset => add({ classes: ["dl-size"], dataset: { asset }, text: "Size unavailable" }));
  const totals = aggregates.map(refs => add({ classes: ["dl-size"], dataset: { assets: JSON.stringify(refs) } }));
  const version = add({ dataset: { latestVersion: "" }, text: "Version unavailable" });
  const controls = add({ id: "recording-filters", hidden: true });
  const voice = controls.appendChild(new Element({ id: "recording-voice" }));
  const language = controls.appendChild(new Element({ id: "recording-language" }));
  const result = controls.appendChild(new Element({ id: "recording-results" }));
  const empty = add({ id: "recording-empty", hidden: true });
  const install = add({ id: "install" });
  const cards = [], rows = [];
  if (withRows) for (const [id, name, languages] of [["donated", "Community voice", ["English", "Deutsch"]], ["default", "Included voice", ["English"]]]) {
    const card = add({ id, classes: ["dl-voice"] }); cards.push(card);
    const button = card.appendChild(new Element({ classes: ["dl-play"] }));
    button.setAttribute("aria-label", `Play a sample of ${name}`);
    button.setAttribute("aria-pressed", "false");
    const audio = card.appendChild(new Element({ classes: ["dl-audio"] }));
    audio.tagName = "audio"; audio.paused = true; audio.pauseCalls = 0;
    audio.play = () => { audio.paused = false; audio.fire("play"); return Promise.resolve(); };
    // The native pause event is asynchronous; state must reset even before it is delivered.
    audio.pause = () => { audio.paused = true; audio.pauseCalls++; };
    const heading = card.appendChild(new Element({ classes: ["dl-group-title"] }));
    const list = card.appendChild(new Element({ classes: ["dl-files"] }));
    for (const lang of languages) rows.push(list.appendChild(new Element({ id: `${id}-${lang}`, dataset: { recording: "", voice: id, voiceName: name, language: lang } })));
  }
  let candidate;
  if (withPreferred) {
    const row = add({ id: "female-narrator", classes: ["dl-voice"], dataset: { recording: "", voice: "female-narrator", voiceName: "Female narrator", language: "English" } });
    const size = row.appendChild(new Element({ classes: ["dl-size", "dl-total-size"], dataset: { assets: JSON.stringify(["latest:Legacy.zip", "latest:Places.zip"]) } }));
    const kind = row.appendChild(new Element({ classes: ["dl-size-kind"], text: "Total download" }));
    const details = row.appendChild(new Element({ classes: ["dl-install-choice"], dataset: { preferred: "v0.9.0:LoreForever_Voice_Female_enUS-complete.zip" } }));
    details.tagName = "DETAILS";
    const files = details.appendChild(new Element({ classes: ["dl-files"] }));
    const block = details.appendChild(new Element({ classes: ["dl-preferred"], hidden: true }));
    const link = block.appendChild(new Element({ dataset: { preferredLink: "" } }));
    const note = details.appendChild(new Element({ classes: ["dl-fallback-note"], text: "Install both ZIPs." }));
    const alternatives = details.appendChild(new Element({ classes: ["dl-alternatives"] })); alternatives.tagName = "DETAILS";
    const part = alternatives.appendChild(new Element({ id: "female-answers-places" }));
    const heading = details.appendChild(new Element({ classes: ["dl-fallback-title"], text: "Manual downloads" }));
    candidate = { row, size, kind, details, block, link, note, part, alternatives, heading, files };
  }
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  runInNewContext(script, { document, window, location, navigator: { sendBeacon() {} }, fetch: url => {
    calls.push(url); return pending.then(() => { if (reject) throw Error("offline"); return { ok, json: async () => data }; });
  } });
  return { document, window, location, calls, sizes, totals, candidate, version, controls, voice, language, result, empty, cards, rows, install, finish: async () => { resolve(); await settle(); } };
}

test("filtering pauses a hidden sample and resets its button/card state immediately without restarting it", async () => {
  const h = setup();
  const card = h.cards[0], audio = card.querySelector(".dl-audio"), button = card.querySelector(".dl-play");
  const label = button.getAttribute("aria-label");
  button.fire("click");
  assert.equal(audio.paused, false);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(card.classList.contains("dl-on"), true);
  h.language.value = "Deutsch"; h.language.fire("change");
  assert.equal(audio.paused, false, "a visible voice sample keeps playing");
  h.voice.value = "default"; h.voice.fire("change");
  assert.equal(card.hidden, true);
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.getAttribute("aria-label"), label);
  assert.equal(button.innerHTML, "&#9654;");
  assert.equal(card.classList.contains("dl-on"), false);
  h.voice.value = h.language.value = ""; h.voice.fire("change");
  assert.equal(card.hidden, false);
  assert.equal(audio.paused, true, "revealing a voice does not restart playback");
  await h.finish();
});

test("a preferred bundle only activates when the exact catalog tag and filename are confirmed", async () => {
  const file = "LoreForever_Voice_Female_enUS-complete.zip";
  for (const options of [{ reject: true }, { data: { byTag: { latest: { [file]: 700e6 }, "v0.8.0": { [file]: 700e6 } } } }, { data: { byTag: { "v0.9.0": { [file]: "700000000" } } } }]) {
    const h = setup({ withPreferred: true, ...options }); await h.finish();
    assert.equal(h.candidate.block.hidden, true);
    assert.equal(h.candidate.link.getAttribute("href"), undefined);
    assert.equal(h.candidate.kind.textContent, "Total download");
  }
  const h = setup({ withPreferred: true, data: { latestTag: "v1.0.0", byTag: { "v0.9.0": { [file]: 700e6 }, latest: { "Legacy.zip": 500e6, "Places.zip": 100e6 } } } });
  await h.finish();
  assert.equal(h.candidate.block.hidden, false);
  assert.equal(h.candidate.size.textContent, "700 MB");
  assert.equal(h.candidate.kind.textContent, "One ZIP");
  assert.equal(h.candidate.files.hidden, false, "filtering leaves install links visible inside a shown row");
  assert.equal(h.candidate.heading.textContent, "Component alternatives");
  assert.match(h.candidate.link.getAttribute("href"), /\/releases\/download\/v0\.9\.0\/LoreForever_Voice_Female_enUS-complete\.zip$/);
  h.voice.value = "default"; h.voice.fire("change");
  assert.equal(h.candidate.row.hidden, true, "table row is itself the recording choice");
  h.location.hash = "#female-answers-places"; h.window.fire("hashchange");
  assert.equal(h.candidate.row.hidden, false);
  assert.equal(h.candidate.details.open, true);
  assert.equal(h.candidate.alternatives.open, true);
  assert.equal(h.candidate.part.scrolled, true);
});
