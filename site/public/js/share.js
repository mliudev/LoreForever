// Share a link (LOR-150): the device's own share sheet where there is one (phones, Chrome and Edge on Windows), else
// copy it. Used by the profile page (public/js/profile.js) and /account. Resolves to what happened: "shared",
// "cancelled" (the share sheet was closed), "copied", or "failed" (nothing worked: show the link instead).
window.lfShare = async ({ url, text }) => {
  if (navigator.share) {
    try {
      await navigator.share({ title: text, text, url });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";   // anything else (no share target, say): copy it instead
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (e) {
    return "failed";
  }
};
