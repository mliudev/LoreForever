// The funnel's stages on /admin's Growth tab, from GET /api/admin's "funnel" (lib/activity.js funnelReport plus its
// stores and companions). Kept apart from admin.html so site/tests/admin-funnel.test.mjs can check it.
//
// Each stage: {key, name, n (null: not counted), share ({pct, of} or null), note}. A stage gets a share only when its
// people are part of the stage it's measured against: profiles of accounts, companion syncs of profiles, coming back of
// accounts, this site's downloads of all installs. Accounts aren't part of any download count (most players get the
// add-on through the CurseForge app), and the companion's check-ins come from installers this site doesn't all see,
// so those stay plain counts.

const pct = (n, of) => of ? Math.round(100 * n / of) + "%" : null;
const share = (n, of, name) => n != null && of ? { pct: pct(n, of), of: name } : null;
const num = n => (n || 0).toLocaleString("en-US");

export function funnelStages(f) {
  const s = f.stages, st = f.stores || {}, c = f.companions, a = st.author;
  // Installs from every source: CurseForge's installs that took the last full release (the app updates installed
  // add-ons) plus GitHub's release downloads, which include this site's (its links redirect there). Without GitHub's
  // numbers, this site's own downloads stand in for them.
  const cf = st.inUse?.n ?? null, gh = st.github?.downloads ?? null;
  const reach = cf == null ? null : cf + Math.max(gh ?? 0, s.downloads);
  const stages = [];
  if (a?.thisWeek) {
    stages.push({ key: "unique", name: "Unique CurseForge downloaders this week", n: a.thisWeek.unique, share: null,
      note: `today ${num(a.today.unique)} · ${num(a.thisWeek.downloads)} downloads this week (the author dashboard's)` });
  }
  stages.push({ key: "reach", name: "Installs, every source", n: reach, share: null,
    note: reach == null ? "waiting for CurseForge's numbers"
      : `CurseForge ${num(cf)} (installs that took ${st.inUse.name.replace(/^Lore Forever /, "")} within its day) + ` +
        (gh != null ? `GitHub ${num(gh)} (release downloads, this site's included)` : `this site ${num(s.downloads)}`) });
  stages.push({ key: "site", name: "From this site", n: s.downloads, share: share(s.downloads, reach, "installs, every source"),
    note: "add-on downloads through this site's installer and zip links" });
  stages.push({ key: "companion", name: "Companion running", n: c ? c.installs : null, share: null,
    note: c ? "installs that checked in, with an account or not (kept 90 days; internal builds left out)"
            : "no check-ins yet: the companion sends them from its next release" });
  stages.push({ key: "accounts", name: "Signed in", n: s.accounts, share: null,
    note: "accounts, each a Google sign-in (admin and test accounts left out)" });
  stages.push({ key: "profiles", name: "Made a profile", n: s.profiles, share: share(s.profiles, s.accounts, "accounts"), note: "" });
  stages.push({ key: "synced", name: "Synced from the companion", n: s.companion, share: share(s.companion, s.profiles, "profiles"),
    note: "the companion keeps their profile up to date" });
  stages.push({ key: "returning", name: "Came back", n: s.returning, share: share(s.returning, s.accounts, "accounts"),
    note: "signed in or synced on 2+ different days" });
  return stages;
}
