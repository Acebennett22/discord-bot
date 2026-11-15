// First-run setup wizard (dashboard/views/setup.ejs).
// Step navigation happens client-side: submit a step (or click a sidebar
// step link) and the next step's HTML is fetched and swapped in — no full
// reload, history stays correct via pushState. The server still validates
// every step and the test-connection buttons still hit the server via
// fetch. With JS disabled, the same forms POST normally and the server
// redirects to the next step.
(function () {
  'use strict';

  function contentEl() { return document.querySelector('.settings-content'); }
  function sidebarEl() { return document.querySelector('.sidebar nav'); }

  // Swap in fetched step HTML (a full setup page) and fix the sidebar.
  function swapStep(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const freshContent = doc.querySelector('.settings-content');
    const freshNav = doc.querySelector('.sidebar nav');
    const current = contentEl();
    if (freshContent && current) current.replaceWith(freshContent);
    if (freshNav && sidebarEl()) sidebarEl().replaceWith(freshNav);
    if (url) history.pushState(null, '', url);
    window.scrollTo(0, 0);
  }

  async function loadStep(url) {
    try {
      const res = await fetch(url, { headers: { Accept: 'text/html' } });
      if (!res.ok) { window.location.href = url; return; }
      swapStep(await res.text(), url);
    } catch {
      window.location.href = url; // offline / fetch failed: fall back to a real navigation
    }
  }

  // Sidebar step links + "Back" links navigate client-side.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/setup/"]');
    if (!a) return;
    e.preventDefault();
    loadStep(a.href);
  });

  // Step forms (POST /setup/:step, /setup/finish) submit via fetch.
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (!form.action.includes('/setup/')) return;
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      // Submit as URL-encoded, not multipart: the server only parses
      // express.urlencoded()/json — a FormData (multipart) POST arrives
      // with an empty req.body, so every step failed validation with
      // "required" even when the fields were filled (1.14.7).
      const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) });
      if (!res.ok) { window.location.href = form.action; return; }
      swapStep(await res.text(), res.url);
      // fetch follows the server's error redirect, so a failed step still
      // returns 200 — only toast success when there is no error param.
      if (!res.url.includes('error=')) AceBot.toast('Step saved');
    } catch {
      window.location.href = form.action;
    } finally {
      if (btn) { btn.textContent = original; btn.disabled = false; }
    }
  });

  // Test-connection buttons (delegated — the content swaps between steps).
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#test-discord')) {
      const out = document.getElementById('test-discord-result');
      const token = document.querySelector('input[name=token]')?.value || '';
      if (out) out.textContent = 'Testing…';
      try {
        const r = await AceBot.postJSON('/setup/api/test-discord', { token });
        if (out) out.textContent = r.ok ? `✅ Connected as ${r.username}` : `❌ ${r.error}`;
      } catch (err) { if (out) out.textContent = '❌ ' + err.message; }
      return;
    }
    if (e.target.closest('#test-db')) {
      const out = document.getElementById('test-db-result');
      const form = document.querySelector('form');
      const fd = form ? new FormData(form) : new FormData();
      if (out) out.textContent = 'Testing…';
      try {
        const r = await AceBot.postJSON('/setup/api/test-db', Object.fromEntries(fd));
        if (out) out.textContent = r.ok ? '✅ Connected' : `❌ ${r.error}`;
      } catch (err) { if (out) out.textContent = '❌ ' + err.message; }
      return;
    }
    if (e.target.closest('#gen-secret')) {
      const el = document.getElementById('session-secret');
      if (el) {
        const a = new Uint8Array(32);
        crypto.getRandomValues(a);
        el.value = [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
      }
    }
  });

  // Port field keeps the redirect URI in sync (localhost only).
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'dash-port') return;
    const uri = document.getElementById('redirect-uri');
    if (uri && uri.value.startsWith('http://localhost:')) {
      uri.value = `http://localhost:${e.target.value || 3010}/callback`;
    }
  });

  // Back/forward buttons re-load the step they point at.
  window.addEventListener('popstate', () => loadStep(window.location.href));
})();
