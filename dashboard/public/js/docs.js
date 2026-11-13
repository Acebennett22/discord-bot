// Wiki/docs search (dashboard/views/docs.ejs).
// Client-side only: filters headings, command rows, guide cards and FAQ
// items as you type — no server round-trip. An empty query shows everything.
(function () {
  'use strict';
  const input = document.getElementById('docs-search');
  const result = document.getElementById('docs-search-result');
  if (!input) return;

  function matches(el, q) {
    return el.textContent.toLowerCase().includes(q);
  }

  function filter() {
    const q = input.value.trim().toLowerCase();
    let visible = 0;
    // Command rows: hide non-matching rows; hide a whole category card
    // when none of its rows match.
    document.querySelectorAll('[data-command-row]').forEach((row) => {
      const show = !q || matches(row, q);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    document.querySelectorAll('[data-category]').forEach((card) => {
      const anyVisible = [...card.querySelectorAll('[data-command-row]')].some((r) => r.style.display !== 'none');
      card.style.display = !q || anyVisible ? '' : 'none';
    });
    // Guides + FAQ cards.
    document.querySelectorAll('[data-guide], [data-faq]').forEach((card) => {
      const show = !q || matches(card, q);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    // Getting-started section.
    document.querySelectorAll('#docs-content > section[data-searchable]:first-child').forEach((sec) => {
      sec.style.display = !q || matches(sec, q) ? '' : 'none';
    });
    if (result) {
      result.textContent = q ? (visible ? `${visible} matching item${visible === 1 ? '' : 's'} — clear the search to see everything.` : 'No matches — try a different word.') : '';
    }
  }

  input.addEventListener('input', filter);
})();
