// The LOR-121 smoke test for a signed-in browser: the same steps as smoke-bulk-upload.mjs, for a site where you can
// sign in but don't want to copy the session cookie anywhere (the develop site, or a preview with sign-in). Open the
// site, sign in, then paste this whole file into the browser console (or run it with a browser automation tool).
// It resolves to a log and throws on the first failure. Like the Node version, only use it on a preview or the
// develop site: it saves a voice called "Smoke Test Voice" and deDE edits marked [Smoke ...], which are disposable.
//
// Differences from the Node version: the 60 recordings are made up here (an ID3 header and noise, which is all the
// server checks), and the zip is written here, stored, since the page's modules only read zips.

(async () => {
  const { gather, matchVoice, voiceStatus, readKit, kitSections, planKit } = await import("/js/bulk-core.js");
  const { openZip } = await import("/js/unzip.js");
  const { crc32, crcHex } = await import("/voices/crc32.js");
  const log = [];
  const say = s => { log.push(s); console.log(s); };
  const check = (ok, msg) => { if (!ok) throw new Error(`${msg}\n${log.join("\n")}`); };
  const enc = new TextEncoder();
  const sleep = s => new Promise(r => setTimeout(r, s * 1000));
  async function api(path, init = {}) {
    for (;;) {
      const r = await fetch(path, { cache: "no-store", ...init });
      if (r.status === 429) {
        const b = await r.clone().json().catch(() => ({}));
        if (b.retryAfter) { say(`  (rate limit: waiting ${b.retryAfter} s)`); await sleep(b.retryAfter); continue; }
      }
      return r;
    }
  }
  const json = async (path, init) => { const r = await api(path, init); check(r.ok, `${path}: ${r.status}`); return r.json(); };
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // A stored zip: {path: Uint8Array | string}.
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const [name, body] of Object.entries(files)) {
      const data = typeof body === "string" ? enc.encode(body) : body, n = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, n.length, true);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
      parts.push(new Uint8Array(h.buffer), n, data);
      central.push(new Uint8Array(c.buffer), n);
      offset += 30 + n.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0), count = Object.keys(files).length;
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
  }

  // ---- 1. A zip of 60 recordings ----
  const state0 = await json("/api/studio/state");
  check(state0.signedIn, "sign in first");
  if (!state0.release.agreed) await post("/api/studio/release", { agree: true, adult: true, signature: "Smoke Test", release: state0.release.version });
  let voice = state0.voices.find(v => v.name === "Smoke Test Voice" && v.locale === "enUS")?.id;
  if (!voice) voice = (await (await post("/api/studio/voice", { name: "Smoke Test Voice", locale: "enUS" })).json()).id;
  check(voice, "couldn't make a voice (at most 2 per account: remove one or rename it to Smoke Test Voice)");
  say(`voice: ${voice}`);
  const lines = await json("/voices/lines.json");
  const items = lines.groups.flatMap(g => g.stories.flatMap(s => s.lines)).map(l => ({ id: l.id, file: l.file, hash: l.hash.enUS || null }));
  const picked = items.filter(it => it.hash).slice(0, 60);
  const files = {};
  for (const [i, it] of picked.entries()) {
    const noise = crypto.getRandomValues(new Uint8Array(400 + i));
    files[`My recordings/${it.file}.mp3`] = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...noise]);
  }
  files["My recordings/notes.txt"] = "not a recording";

  async function drop(name, blob) {
    const { files: got } = await gather([{ name, size: blob.size, blob }], "voice");
    const m = await matchVoice(got, items);
    const { takes } = await json(`/api/studio/state?voice=${encodeURIComponent(voice)}`);
    const plan = { new: [], replaced: [], unchanged: [] };
    for (const row of m.rows) {
      const buf = (await row.read()).slice().buffer;
      plan[voiceStatus(takes[row.it.id], buf, row.hash)].push({ row, buf });
    }
    return { m, plan };
  }
  const first = await drop("My recordings.zip", zip(files));
  say(`zip: ${first.m.rows.length} recordings, ${first.plan.new.length} new, ${first.plan.replaced.length} replaced, ${first.plan.unchanged.length} unchanged, ${first.m.other} other files`);
  check(first.m.rows.length === picked.length, "every recording matched a line");
  let n = 0;
  for (const { row, buf } of [...first.plan.new, ...first.plan.replaced]) {
    const bytes = new Uint8Array(buf);
    const r = await api(`/api/studio/take?voice=${encodeURIComponent(voice)}&line=${encodeURIComponent(row.it.id)}`, { method: "PUT", body: bytes,
      headers: { "X-CRC32": crcHex(crc32(bytes)), "X-Text-Hash": row.hash, "X-File-Name": encodeURIComponent(row.path.split("/").pop()), "X-Checks": "%7B%7D" } });
    check(r.status === 200, `${row.it.id}: ${r.status} ${await r.text()}`);
    if (++n % 20 === 0) say(`  saved ${n}`);
  }
  const { takes } = await json(`/api/studio/state?voice=${encodeURIComponent(voice)}`);
  for (const it of picked) check(takes[it.id]?.crc32 === crcHex(crc32(files[`My recordings/${it.file}.mp3`])), `${it.id} landed`);
  say(`voice: all ${picked.length} lines landed per line`);

  const packRes = await api(`/api/studio/pack?voice=${encodeURIComponent(voice)}`);
  check(packRes.status === 200, `pack: ${packRes.status}`);
  const packBlob = new Blob([await packRes.arrayBuffer()]);
  const pack = await openZip(packBlob);
  for (const it of picked) {
    const e = pack.entries.find(x => x.name.endsWith(`/Audio/${it.file}.mp3`));
    check(e, `${it.file}.mp3 is in the test pack`);
    const got = await pack.read(e), want = files[`My recordings/${it.file}.mp3`];
    check(got.length === want.length && got.every((b, i) => b === want[i]), `${it.file}.mp3 comes back byte for byte`);
  }
  say(`test pack: ${packRes.headers.get("X-Pack-Lines")} lines, all ${picked.length} uploads byte for byte`);
  const back = await drop("LoreForever_Voice_Test.zip", packBlob);
  check(back.m.pack && back.plan.new.length + back.plan.replaced.length === 0, "the returned test pack is all unchanged");
  say(`returned test pack: ${back.plan.unchanged.length} unchanged, nothing to save`);

  // ---- 2. The deDE kit, edited ----
  const kit = await openZip(await (await fetch("/translate/kits/deDE.zip")).blob());
  const edited = {}, changed = [];
  let staleId = null;
  const tag = `[Smoke ${Date.now() % 100000}]`;
  for (const e of kit.entries) {
    let bytes = await kit.read(e);
    if (/\/(ui|lore\/zones_01)\.json$/.test(e.name)) {
      const rows = JSON.parse(new TextDecoder().decode(bytes));
      let k = 0;
      for (const r of rows) {
        if (!r.en || /[%|"\\\n]/.test(r.en + (r.text || ""))) continue;   // plain text, so it reads back the same from Lua
        if (k < 3) { r.text = `${r.text || r.en} ${tag}`; changed.push(r.id); k++; }
        else if (!staleId && e.name.endsWith("zones_01.json")) { r.en += " (older English)"; r.text = "Veraltet"; staleId = r.id; }
      }
      bytes = enc.encode(JSON.stringify(rows, null, 2));
    }
    edited[e.name] = bytes;
  }
  const edZip = zip(edited);
  const { files: kitFiles } = await gather([{ name: "deDE-edited.zip", size: edZip.size, blob: edZip }], "kit");
  const read = await readKit(kitFiles);
  const entrySection = Object.fromEntries(await json("/translate/data/en/entries.json"));
  const english = {}, published = {};
  for (const sid of kitSections(read.rows, entrySection)) {
    for (const [id, en] of (await json(`/translate/data/en/${sid}.json`)).strings) english[id] = en;
    Object.assign(published, await (await fetch(`/translate/data/deDE/${sid}.json`)).json().catch(() => ({})));
  }
  const mine = {};
  for (const e of (await json("/api/translations/edits?locale=deDE")).edits) if (e.status === "new" || e.status === "accepted") mine[e.string_id] = e.text;
  const plan = planKit(read.rows, { english, published, mine, entrySection });
  say(`kit: ${plan.new.length} new, ${plan.replaced.length} replaced, ${plan.unchanged.length} unchanged, ${plan.stale.length} stale, ${plan.unknown.length} unknown, ${plan.failed.length} failed`);
  const rows = [...plan.new, ...plan.replaced];
  check(JSON.stringify(rows.map(r => r.id).sort()) === JSON.stringify([...changed].sort()), "exactly the edited strings would be saved");
  check(plan.stale.some(r => r.id === staleId), "the string with older English is skipped");
  const res = await post("/api/translations/import", { locale: "deDE", edits: rows.map(({ id, en, text }) => ({ id, en, text })) });
  const body = await res.json();
  check(res.status === 200 && body.saved === rows.length, `import: ${res.status} ${JSON.stringify(body)}`);
  const after = (await json("/api/translations/edits?locale=deDE")).edits;
  for (const r of rows) check(after.some(e => e.string_id === r.id && e.text === r.text && e.status === "new"), `${r.id} saved as an edit`);
  say(`kit: ${rows.length} strings landed as edits (status new)`);
  const tp = await api("/api/translations/pack?locale=deDE");
  check(tp.status === 200, `deDE pack: ${tp.status}`);
  const tz = await openZip(await tp.blob());
  let lua = "";
  for (const e of tz.entries.filter(e => e.name.endsWith(".lua"))) lua += new TextDecoder().decode(await tz.read(e));
  for (const r of rows) check(lua.includes(r.text), `${r.id} is in the test pack`);
  say(`deDE test pack: ${tp.headers.get("X-Strings-Included")} strings, including all ${rows.length} uploaded`);
  say("ok");
  return log.join("\n");
})();
