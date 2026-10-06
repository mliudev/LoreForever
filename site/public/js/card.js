// The share card (lib/sharecard.js, LOR-150): on the owner's public profile, when its card is out of date
// (lib/profiles.js puts the facts in #pf-sharecard only then), draw the 1200x630 picture that links to the profile
// show, and send it to POST /api/profile/card. Quietly: nothing on the page changes, and if anything fails the next visit
// tries again. Harold (LOR-266) is on it while the "companion" feature is on.
(() => {
  const el = document.getElementById("pf-sharecard");
  if (!el || !window.fetch || !window.HTMLCanvasElement || !HTMLCanvasElement.prototype.toBlob) return;
  let f;
  try { f = JSON.parse(el.textContent); } catch (e) { return; }

  const W = 1200, H = 630, LEFT = 64;
  const GOLD = "#ffd100", PARCH = "#e9d8ad", TEXT = "#e8e0d2", MUTED = "#a39683";
  const HEAD = "Cinzel, Georgia, serif", SERIF = "Georgia, 'Times New Roman', serif";
  const BODY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const image = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  // The biggest size up to `size` at which `text` fits in `max` px.
  function fit(x, text, font, size, max) {
    for (; size > 24; size -= 2) {
      x.font = font(size);
      if (x.measureText(text).width <= max) break;
    }
    return size;
  }

  // `text` in at most `count` lines of `max` px, the last one cut short with an ellipsis when it doesn't all fit.
  function lines(x, text, max, count) {
    const words = String(text || "").split(/\s+/).filter(Boolean), out = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const next = cur ? `${cur} ${words[i]}` : words[i];
      if (!cur || x.measureText(next).width <= max) { cur = next; continue; }
      out.push(cur);
      cur = words[i];
      if (out.length === count) {
        let last = `${out[count - 1]} ${words.slice(i).join(" ")}`;
        while (x.measureText(last + "…").width > max && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
        out[count - 1] = last + "…";
        return out;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function box(x, left, top, w, h, r) {
    x.beginPath();
    if (x.roundRect) x.roundRect(left, top, w, h, r); else x.rect(left, top, w, h);
  }

  async function draw() {
    if (document.fonts) {
      await Promise.all([document.fonts.load(`700 80px Cinzel`), document.fonts.load(`600 24px Cinzel`)]).catch(() => {});
    }
    const [logo, harold] = await Promise.all([image("/img/logo.svg"), f.herald ? image("/img/harold.svg") : null]);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    const ground = x.createRadialGradient(320, 0, 0, 320, 0, 1150);
    ground.addColorStop(0, "#2a2014");
    ground.addColorStop(0.6, "#0d0b09");
    ground.addColorStop(1, "#070605");
    x.fillStyle = ground;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(216, 178, 90, 0.55)";
    x.lineWidth = 3;
    x.strokeRect(18, 18, W - 36, H - 36);

    x.drawImage(logo, LEFT, 52, 56, 56);
    x.fillStyle = GOLD;
    x.font = `700 30px ${HEAD}`;
    x.textBaseline = "middle";
    x.fillText("Lore Forever", LEFT + 70, 81);
    x.textBaseline = "alphabetic";

    const right = harold ? 850 : W - LEFT;   // Harold stands on the right
    const size = fit(x, f.name, s => `700 ${s}px ${HEAD}`, 88, right - LEFT);
    x.fillStyle = GOLD;
    x.font = `700 ${size}px ${HEAD}`;
    x.fillText(f.name, LEFT, 210);
    x.fillStyle = TEXT;
    x.font = `500 30px ${BODY}`;
    x.fillText([f.sheet, f.faction, f.realm].filter(Boolean).join(" · "), LEFT, 258, right - LEFT);

    const gap = 14, tw = (right - LEFT - 3 * gap) / 4;
    f.tiles.forEach(([label, n], i) => {
      const tx = LEFT + i * (tw + gap), ty = 292;
      box(x, tx, ty, tw, 108, 8);
      x.fillStyle = "rgba(8, 10, 22, 0.85)";
      x.fill();
      x.strokeStyle = "#5b5f6e";
      x.lineWidth = 1;
      x.stroke();
      x.textAlign = "center";
      x.fillStyle = GOLD;
      x.font = `700 44px ${HEAD}`;
      x.fillText(Number(n).toLocaleString("en-US"), tx + tw / 2, ty + 58, tw - 16);
      x.fillStyle = MUTED;
      x.font = `500 20px ${BODY}`;
      x.fillText(label, tx + tw / 2, ty + 90, tw - 16);
      x.textAlign = "left";
    });

    x.fillStyle = PARCH;
    x.font = `italic 28px ${SERIF}`;
    lines(x, f.line, right - LEFT, 2).forEach((l, i) => x.fillText(l, LEFT, 456 + i * 38));

    x.fillStyle = MUTED;
    x.font = `500 22px ${BODY}`;
    x.fillText(f.address, LEFT, H - 58);

    if (harold) {
      x.drawImage(harold, 870, 230, 300, 300);
      x.textAlign = "center";
      x.fillStyle = PARCH;
      x.font = `italic 22px ${SERIF}`;
      x.fillText("Written by Harold", 1020, H - 58);
      x.textAlign = "left";
    }
    return new Promise(ok => c.toBlob(ok, "image/jpeg", 0.9));
  }

  draw().then(blob => blob && fetch("/api/profile/card", {
    method: "POST", credentials: "same-origin", body: blob,
    headers: { "Content-Type": "image/jpeg", "X-Card-Key": f.key },
  })).catch(() => {});
})();
