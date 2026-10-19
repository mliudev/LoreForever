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

// lines.json keeps only the English text (Pages refuses files over 25 MiB); each other language's text is in
// /voices/lines/<locale>.json, {line id: text}. Puts it on the lines as text[locale]; true when the language's text is there.
export async function loadLocaleText(fetcher, data, locale) {
  if (!data || !locale || locale === "enUS") return true;
  if (data.textLoaded?.has(locale)) return true;
  try {
    const response = await fetcher(`/voices/lines/${encodeURIComponent(locale)}.json`, { cache: "no-store" });
    if (!response.ok) return false;
    const texts = await response.json();
    for (const g of data.groups) for (const s of g.stories) for (const l of s.lines) if (texts[l.id]) l.text[locale] = texts[l.id];
    (data.textLoaded ||= new Set()).add(locale);
    return true;
  } catch {
    return false;
  }
}

// Only changed English needs a notice; languages do not carry quality labels.
export function scriptReviewNote(status, entry, locale) {
  if (locale === "enUS" || !status) return "";
  if (Array.isArray(status.stale) && status.stale.includes(entry)) return "The English source changed. Check and correct this script before recording.";
  return "";
}
