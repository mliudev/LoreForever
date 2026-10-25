// /faq as a book (faq.css). The page works without this file: every chapter and every answer is open on one long page,
// and the chapters on the left are links down to them. This turns it into the book: the chapters stay on the left page,
// the chosen chapter's questions are the right page (the first one open), and on a phone only one page shows at a time,
// with a button back to the chapters. Where you are is the address, so Back, a pasted link and an old link all work:
//   /faq                chapter 1 (a phone starts on the chapters)
//   /faq#ch-narration   a chapter
//   /faq#mac            a question (/faq#live-game, a line inside one): its chapter turns up with it open
//   /faq#chapters       a phone's chapter list
// Opening a question puts its address in the bar, so a link to it is one copy away. The script runs where it is loaded
// (just after the book), so the page never shows the long version first. On Willo's door (willocompanion.com/faq) there
// is no book, only her plain list: the questions are folded and a question's address still opens it.
(() => {
  const book = document.getElementById("faq-book");
  if (!book) return;
  const willo = document.documentElement.dataset.door === "willo";
  const chapters = [...book.querySelectorAll(".fq-chapter")];
  const links = [...book.querySelectorAll(".fq-toc a[data-ch]")];
  const questions = [...book.querySelectorAll("details.fq-q")];
  const who = book.querySelector(".fq-who");
  const phone = matchMedia("(max-width: 720px)");

  const fold = (q, open) => { q.open = open; };
  const place = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    const chapter = el && el.closest(".fq-chapter");
    return { el, chapter: chapter ? chapters.indexOf(chapter) : -1, question: el && el.closest("details.fq-q"), list: id === "chapters" };
  };

  // Show chapter i (and, on a phone, its page); with a question given, open that one, else the chapter's first.
  let current = -1;
  function show(i, { question, side, fresh } = {}) {
    const changed = i !== current;
    chapters.forEach((c, n) => { c.hidden = n !== i; });
    links.forEach((a, n) => { if (n === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    if (who) who.textContent = chapters[i].querySelector("h2").textContent;
    if (question) fold(question, true);
    else if (changed || fresh) { questions.forEach(q => fold(q, false)); fold(chapters[i].querySelector("details.fq-q"), true); }
    if (side) book.dataset.side = side;
    current = i;
  }

  // Everything starts folded; a page with no address for a question gets chapter 1's first.
  questions.forEach(q => fold(q, false));
  if (willo) {
    fold(questions[0], true);
    const open = () => {
      const { question, el } = place();
      if (question) { fold(question, true); question.scrollIntoView(); } else if (el) el.scrollIntoView();
    };
    open();
    addEventListener("hashchange", open);
    return;
  }

  book.classList.add("fq-on");
  book.dataset.side = "l";
  const route = (scroll) => {
    const { el, chapter, question, list } = place();
    if (chapter >= 0) {
      show(chapter, { question, side: "r", fresh: !question });
      if (scroll) requestAnimationFrame(() => (question || el).scrollIntoView());
    } else if (list) {
      show(current < 0 ? 0 : current, { side: "l" });   // a phone's way back: the chapter you were in stays marked
    } else {
      show(0, { side: "l" });                           // /faq itself
    }
  };

  // A page turns by the address, without a jump: pushState keeps Back working, and the book is brought into view
  // when it has scrolled away (the right page can be long).
  const go = (hash, then) => {
    history.pushState(null, "", location.pathname + location.search + hash);
    route(false);
    const top = book.getBoundingClientRect().top;
    if (top < 0 || phone.matches) book.scrollIntoView();
    if (then) then();
  };
  links.forEach(a => a.addEventListener("click", e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.getAttribute("href"), () => { if (phone.matches) book.querySelector(".fq-chapter:not([hidden]) h2").focus({ preventScroll: true }); });
  }));
  const back = book.querySelector(".fq-back");
  if (back) back.addEventListener("click", e => {
    e.preventDefault();
    go("#chapters", () => { const a = links[current]; if (a) a.focus({ preventScroll: true }); });
  });
  chapters.forEach(c => c.querySelector("h2").setAttribute("tabindex", "-1"));

  // A question the reader opens puts its own address in the bar (no new Back step).
  book.addEventListener("click", e => {
    const s = e.target.closest("summary");
    const q = s && s.parentElement;
    if (!q || !q.classList.contains("fq-q") || q.open) return;
    history.replaceState(null, "", location.pathname + location.search + "#" + q.id);
  });

  addEventListener("hashchange", () => route(true));
  route(true);
})();
