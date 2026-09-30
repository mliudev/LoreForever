// Helpers shared by the public forms (/api/feedback, /api/voices). Kept outside functions/ so Pages doesn't route it.

// A form value as a trimmed string with Unix line breaks, cut to `max` characters.
export const clean = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

// A ticked checkbox, from a form post ("on") or JSON (true).
export const ticked = v => v === true || v === "on" || v === "1";

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A per-day hash of the sender's IP, only used to cap how many times one person can send a form in a day.
export async function senderHash(ip, day) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("loreforever:" + day + ":" + ip));
  return [...new Uint8Array(bytes)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Posts a message to a Discord webhook. Best effort: a failure never blocks saving the form.
export async function postWebhook(webhook, content) {
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
  } catch (e) {}
}
