// "Add <name> as a friend" on /willo?shared=<code> (functions/willo.js, lib/friends.js friendOffer, LOR-611): a signed-in
// visitor adds the player whose Share Willo link this is. A player's link counts as their yes, so it's one click.
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-add-friend]");
  if (!button) return;
  const status = document.querySelector("[data-add-friend-status]");
  button.disabled = true;
  try {
    const r = await fetch("/api/friends/add", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: button.dataset.addFriend }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || "That didn't work. Try again in a moment.");
    button.hidden = true;
    if (status) status.textContent = d.state === "friends" ? "You're friends now. Write to each other in Willo's Friends tab."
      : "Request sent. You'll be friends when they say yes.";
  } catch (err) {
    button.disabled = false;
    if (status) status.textContent = err.message;
  }
});
