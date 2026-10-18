// Pure contributor workflow rules, shared by the dashboard and its tests.
const ENTRY = /^[a-z]+:[a-z0-9-]+$/;
const VOICE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function recordingContext(params) {
  const entry = params.get("entry") || "";
  if (!ENTRY.test(entry)) return null;
  const candidate = params.get("line") || entry;
  const line = candidate === entry || new RegExp("^" + entry + "#faq[1-9][0-9]*$").test(candidate) ? candidate : entry;
  const voice = params.get("voice") || "";
  return { entry, line, voice: VOICE.test(voice) ? voice : "" };
}
export function studioLink(context, locale) {
  const params = new URLSearchParams({ lang: locale, line: context.line });
  if (context.voice) params.set("voice", context.voice);
  return "/voices/studio?" + params;
}
export function usableEdit(edit, english) {
  return Boolean(edit && ["new", "accepted"].includes(edit.status) && typeof edit.en === "string" && edit.en === english);
}
export function editNote(edit, english, currentText, draft, staleEntry = false) {
  if (edit && ["new", "accepted"].includes(edit.status)) {
    if (!usableEdit(edit, english)) return ["English changed or could not be checked. Your saved edit is kept below; compare it before saving again.", "td-no"];
    return [edit.text === currentText ? "Checked by you: saved, awaiting import." : "Saved, awaiting import.", "td-new"];
  }
  if (staleEntry && !currentText) return ["English changed: translate this line again.", "td-todo"];
  if (edit?.status === "rejected") {
    // The automated check's note (lore.kit pull); a rejection from /admin has none.
    const reason = String(edit.reason || "").trim().replace(/[.\s]+$/, "");
    return [reason ? `Not used: ${reason}. Fix it and save again.` : "Your last edit wasn't used. It's below; save it again to send it back.", "td-no"];
  }
  if (edit?.status === "pulled") {
    // What lore.kit did with it (LOR-621). Edits pulled before it said fall back to comparing with the current text.
    const reason = String(edit.reason || "").trim().replace(/[.\s]+$/, "");
    if (edit.outcome === "unusable") return [reason ? `Not used: ${reason}.` : "Not used.", "td-no"];
    if (edit.outcome === "superseded") return ["Not used: a later edit of this line went in instead.", "td-no"];
    if (edit.outcome === "landed" || edit.outcome === "same" || edit.text === currentText) {
      return [edit.shipped_in ? `In the language: shipped in ${edit.shipped_in}.` : "In the language.", "td-ok"];
    }
    return ["Not used: this line has changed since. Check the current text.", "td-no"];
  }
  if (!currentText) return [staleEntry ? "English changed: translate this line again." : "Not translated yet.", "td-todo"];
  return ["", ""];
}
export function narrationFields(context, line) {
  // The generator knows which spoiler-free section a story actually reads.
  if (Array.isArray(line?.fields)) return new Set(line.fields.filter(id => typeof id === "string" && id.startsWith(context.entry + "/")));
  const faq = /#faq([1-9][0-9]*)$/.exec(context.line);
  return new Set(faq ? [context.entry + "/faq/" + faq[1] + "/q", context.entry + "/faq/" + faq[1] + "/a"] : [context.entry + "/n", context.entry + "/s"]);
}
