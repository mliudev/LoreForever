// /guides/edit: the guides editor (lib/guides-cms.js, site/GUIDES.md). The page is only the shell; public/guides/editor.js
// signs the visitor in or tells them they can't edit, lists the articles, and edits one with a live preview. Every
// action goes through /api/guides, which checks the account each time.

import { page, FRESH } from "../../lib/voices.js";
import { HEAD, htmlHeaders } from "../../lib/guides.js";

const BODY = `  <section class="gde" id="gde">
    <h1>Guides editor</h1>
    <p class="gde-msg" id="gde-msg" role="status">Loading&hellip;</p>

    <div id="gde-list" hidden>
      <p class="gde-top"><a class="gde-btn gde-primary" href="/guides/edit?new=1">New article</a>
        <span class="gde-hint">Drafts open only from their link. Published ones are listed on <a href="/guides">/guides</a> and in search.</span></p>
      <table class="gde-table">
        <thead><tr><th>Article</th><th>Status</th><th>Date</th><th>Last saved</th></tr></thead>
        <tbody id="gde-rows"></tbody>
      </table>
    </div>

    <form id="gde-form" hidden autocomplete="off">
      <div class="gde-bar">
        <a href="/guides/edit">&larr; All articles</a>
        <label class="gde-status">Status
          <select id="f-draft">
            <option value="1">Draft: only people with the link</option>
            <option value="0">Published: listed and in search</option>
          </select>
        </label>
        <button type="submit" class="gde-btn gde-primary" id="gde-save">Save</button>
        <a class="gde-btn" id="gde-view" target="_blank" rel="noopener" hidden>Open on the site</a>
        <span class="gde-state" id="gde-state"></span>
      </div>
      <div class="gde-cols">
        <div class="gde-edit">
          <label>Title <input id="f-title" maxlength="160" required></label>
          <label>Address <span class="gde-slug">loreforeverwow.com/guides/<input id="f-slug" maxlength="90" required></span></label>
          <label>Description <span class="gde-count" id="f-desc-n"></span>
            <textarea id="f-description" rows="2" maxlength="170" required></textarea></label>
          <div class="gde-row">
            <label>Kind <select id="f-kind"><option value="tutorial">Guide</option><option value="lore">Lore</option></select></label>
            <label>Date <input type="date" id="f-date" required></label>
            <label>Byline <input id="f-author" placeholder="Lore Forever"></label>
          </div>
          <div class="gde-tools" role="toolbar" aria-label="Formatting">
            <button type="button" data-md="h2" title="Section heading">Heading</button>
            <button type="button" data-md="h3" title="Smaller heading">Subheading</button>
            <button type="button" data-md="b" title="Bold"><b>B</b></button>
            <button type="button" data-md="i" title="Italic"><i>I</i></button>
            <button type="button" data-md="link">Link</button>
            <button type="button" data-md="ul">List</button>
            <button type="button" data-md="quote">Quote</button>
            <button type="button" data-md="faq">FAQ</button>
            <button type="button" id="gde-pic">Add picture</button>
            <input type="file" id="gde-file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
          </div>
          <textarea id="f-body" class="gde-body" rows="28" spellcheck="true"
            placeholder="Write here. Drop or paste pictures in."></textarea>
          <details class="gde-revs"><summary>Earlier versions</summary><ul id="gde-revs"></ul></details>
          <p><button type="button" class="gde-btn gde-danger" id="gde-delete" hidden>Delete article</button></p>
        </div>
        <div class="gde-preview">
          <p class="gde-label">Preview</p>
          <div id="gde-pv"></div>
        </div>
      </div>
    </form>
  </section>`;

export async function onRequestGet() {
  return new Response(page({
    title: "Guides editor", description: "Write, edit and publish the Lore Forever guides.", path: "/guides/edit",
    body: BODY, crumbs: `<a href="/guides">Guides</a> &rsaquo; Editor`, foot: "", robots: "noindex",
    head: `${HEAD}\n<link rel="stylesheet" href="/guides/editor.css?${FRESH}">`,
    scripts: `<script type="module" src="/guides/editor.js?${FRESH}"></script>`,
  }), { headers: { ...htmlHeaders("noindex"), "Cache-Control": "no-store" } });
}
