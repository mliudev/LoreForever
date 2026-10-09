import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { studioContext, editorLink, studioSignIn, refreshCatalog, scriptReviewNote } from "../public/voices/studio-workflow.js";

const english = { id: "english", locale: "enUS", name: "English voice" };
const french = { id: "french", locale: "frFR", name: "French voice" };
const state = (voices = [english, french]) => ({ ok: true, signedIn: true, voices, voice: voices[0]?.id, takes: { kept: { hash: "kept" } }, limits: { bytes: 10000, voices: 2 } });
const catalog = {
  languages: [{ locale: "enUS", lines: 1 }, { locale: "frFR", lines: 1 }],
  groups: [{ name: "Capitals", stories: [{ key: "zone:stormwind", name: { enUS: "Stormwind", frFR: "Hurlevent" }, lines: [{
    id: "zone:stormwind#faq1", file: "stormwind__faq1", text: { enUS: "English original", frFR: "Texte français" },
    q: { enUS: "English question", frFR: "Question française" }, hash: { enUS: "english-hash", frFR: "french-hash" }, hints: { enUS: [], frFR: [] },
  }] }] }],
};

test("catalog refresh keeps the working catalog on network, HTTP and malformed-data failures", async () => {
  for (const fetcher of [async () => { throw Error("offline"); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({}) })]) {
    assert.deepEqual(await refreshCatalog(fetcher, catalog), { data: catalog, fresh: false });
  }
  const refreshed = { ...catalog, updated: "today" };
  let options;
  const result = await refreshCatalog(async (_url, opts) => { options = opts; return { ok: true, json: async () => refreshed }; }, catalog);
  assert.equal(result.data, refreshed);
  assert.equal(result.fresh, true);
  assert.equal(options.cache, "no-store");
});

async function studio(fetcher, search = "") {
  const app = { addEventListener() {}, querySelectorAll: () => [] };
  const source = await readFile(new URL("../public/voices/studio.js", import.meta.url), "utf8");
  const context = vm.createContext({
    studioContext, editorLink, studioSignIn, refreshCatalog, scriptReviewNote,
    document: { getElementById: () => app }, window: { addEventListener() {} }, location: { search }, navigator: { language: "en-US" },
    localStorage: { getItem: () => null, setItem() {} }, fetch: fetcher,
    URLSearchParams, Blob, Uint8Array, Set, console,
    voiceUpload: () => ({}), activeClaim: () => null, loadZones: async () => {}, crc32: () => 123, crcHex: () => "0000007b",
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, "").replace(/load\(new URLSearchParams\(location.search\)\.get\("voice"\)\);\s*$/, "") + `
    render = () => {};
    analyze = async () => ({ buf: new Uint8Array([1, 2, 3]).buffer, checks: { warnings: [] } });
    globalThis.hooks = { load, refreshScript, upload, sourceToolsHtml, rowHtml, signInHref,
      setState(state, data, loc = 'frFR') { st = state; lines = data; browseLocale = loc; buildItems(); },
      getState() { return { st, lines, items, open: [...open], mine: [...mine], catalogNote }; },
      expand(id) { open.add(id); mine.add('zone:stormwind'); } };
  `, context);
  return context.hooks;
}

test("normal upload sends the displayed script hash and keeps the take on a rejected changed script", async () => {
  let uploadOptions;
  const h = await studio(async (url, init) => {
    assert.match(url, /take\?voice=french&line=zone%3Astormwind%23faq1/);
    uploadOptions = init;
    return { json: async () => ({ ok: false, error: "The text changed. Refresh the script." }) };
  });
  const s = { ...state(), voice: "french", takes: { "zone:stormwind#faq1": { hash: "french-hash", ext: "mp3" } } };
  h.setState(s, catalog);
  const result = await h.upload(h.getState().items[0], { name: "recording.mp3", size: 3 });
  assert.equal(result, "bad");
  assert.equal(uploadOptions.headers["X-Text-Hash"], "french-hash");
  assert.equal(h.getState().st.takes["zone:stormwind#faq1"].hash, "french-hash");
});

test("French browsing without a French voice clears the English voice's displayed takes", async () => {
  const h = await studio(async url => ({ ok: true, json: async () => url.includes("state") ? state([english]) : url.includes("lines.json") ? catalog : { draft: [] } }), "?lang=frFR&line=zone%3Astormwind%23faq1");
  await h.load();
  assert.equal(h.getState().st.voice, null);
  assert.deepEqual(Object.keys(h.getState().st.takes), []);
  assert.equal(h.getState().items[0].text, "Texte français");
});

test("a language-only return loads the matching voice's takes instead of keeping the default voice's takes", async () => {
  const calls = [];
  const h = await studio(async url => {
    calls.push(url);
    const chosen = url.includes("voice=french") ? french : english;
    return { ok: true, json: async () => url.includes("state") ? { ...state(), voice: chosen.id, takes: { [chosen.id]: { hash: chosen.id } } }
      : url.includes("lines.json") ? catalog : { draft: [] } };
  }, "?lang=frFR&line=zone%3Astormwind%23faq1");
  await h.load();
  assert.equal(h.getState().st.voice, "french");
  assert.deepEqual(Object.keys(h.getState().st.takes), ["french"]);
  assert.ok(calls.includes("/api/studio/state?voice=french"));
});

test("sign-in follows the displayed language and line after a visitor changes language", async () => {
  const h = await studio(async () => ({}), "?lang=frFR&line=zone%3Astormwind%23faq1&voice=french&zones=1");
  h.setState({ ...state([]), voice: null, signedIn: false, takes: {} }, catalog, "enUS");
  const signIn = new URL(h.signInHref(), "https://example.test");
  const next = new URL(signIn.searchParams.get("next"), "https://example.test");
  assert.equal(next.searchParams.get("lang"), "enUS");
  assert.equal(next.searchParams.get("line"), "zone:stormwind#faq1");
  assert.equal(next.searchParams.get("zones"), "1");
  assert.equal(next.searchParams.has("voice"), false, "a previous language voice cannot override the new language after sign-in");
});
