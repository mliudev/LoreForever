// The owner downloads all sanctioned saved moments via small authenticated pages. Each request independently
// checks ownership and the displayed character; new arrivals after the first page's cursor are excluded.
// No private local capture, account credentials or precise positions exist in this archive.
export async function exportHistory(fetchPage, progress = () => {}) {
  let cursor = '', character = null, next;
  const records = [], cursors = new Set();
  do {
    const response = await fetchPage('/api/profile/history?limit=250' + (cursor ? '&before=' + encodeURIComponent(cursor) : ''));
    if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again to download your history.' :
      'Your history could not be downloaded. Please try again.');
    const page = await response.json();
    if (page.v !== 2 || !Array.isArray(page.records) || page.records.length > 250) throw new Error('Could not read this history page.');
    const current = JSON.stringify([page.name, page.realm]);
    if (character && character !== current) throw new Error('Your displayed character changed. Please try again.');
    character = current;
    records.push(...page.records);
    progress(records.length);
    next = page.next;
    if (next && (typeof next !== 'string' || cursors.has(next))) throw new Error('Could not read this history page.');
    if (next) cursors.add(next);
    cursor = next;
  } while (next);
  const [name, realm] = JSON.parse(character);
  return { v: 2, name, realm, records };
}

if (typeof document !== 'undefined') {
  const link = document.querySelector('[data-history-export]');
  const status = document.querySelector('[data-history-export-status]');
  if (link) {
    link.textContent = 'Download saved history';
    let downloading = false;
    link.addEventListener('click', async event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (downloading) return;
      downloading = true;
      link.setAttribute('aria-disabled', 'true');
      try {
        const archive = await exportHistory(url => fetch(url, { credentials: 'same-origin', cache: 'no-store' }),
          count => { if (status) status.textContent = `Preparing ${count.toLocaleString()} saved moments…`; });
        const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }));
        const download = document.createElement('a');
        download.href = url; download.download = 'lore-forever-history.json'; download.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (status) status.textContent = `Downloaded ${archive.records.length.toLocaleString()} saved moments.`;
      } catch (error) { if (status) status.textContent = error.message; }
      finally { downloading = false; link.removeAttribute('aria-disabled'); }
    });
  }
}
