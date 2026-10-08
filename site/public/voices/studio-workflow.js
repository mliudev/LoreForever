// Navigation and catalog loading for the recording studio. No contributor data is written here.
export function studioContext(state, { lang, voice } = {}) {
  const voices = state.voices || [];
  const explicit = voice && voices.find(v => v.id === voice);
  const selected = voices.find(v => v.id === state.voice);
  // An explicit owned voice wins. A language-only link must never use another language's voice.
  const chosen = explicit || (lang ? (selected?.locale === lang ? selected : voices.find(v => v.locale === lang)) : selected);
  return { voice: chosen?.id || null, locale: chosen?.locale || lang || null };
}

export function editorLink({ id, story }, locale, voice) {
  const q = new URLSearchParams({ lang: locale, entry: story.key, line: id });
  if (voice) q.set("voice", voice);
  return `/translate/dashboard?${q}`;
}

export function studioSignIn(search) {
  return `/account?next=${encodeURIComponent(`/voices/studio${search || ""}`)}`;
}

export async function refreshCatalog(fetcher, previous = null) {
  try {
    const response = await fetcher("/voices/lines.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Catalog unavailable");
    const data = await response.json();
    if (!Array.isArray(data.languages) || !Array.isArray(data.groups) ||
        !data.groups.every(g => Array.isArray(g.stories) && g.stories.every(s => s.key && s.name && Array.isArray(s.lines) &&
          s.lines.every(l => l.id && l.text && l.hash && l.hints)))) throw new Error("Invalid catalog");
    return { data, fresh: true };
  } catch {
    return { data: previous, fresh: false };
  }
}

// Entry review is a prompt to check the displayed script, not proof that every spoken field was reviewed.
export function scriptReviewNote(status, entry, locale) {
  if (locale === "enUS") return "Current English catalog text.";
  if (!status) return "Translation review status unavailable. You can still check this script against the English original.";
  if (Array.isArray(status.stale) && status.stale.includes(entry)) return "The English source changed. Check and correct this script before recording.";
  if (Array.isArray(status.draft) && status.draft.includes(entry)) return "This entry still needs a language check. Read this script before recording; correct any wording that needs it.";
  return "Current catalog translation. Check this script before recording.";
}
