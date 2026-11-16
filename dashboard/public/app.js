// Vikings Hall dashboard — shared client-side layer (vanilla JS, no dependencies).
// Loaded on every page (see partials/header.ejs). Provides toasts, fetch
// helpers, no-reload form saves, section refresh, and row removal.
// Progressive enhancement: every form keeps its method/action, so with JS
// disabled the browser still POSTs normally and the server redirects back
// with ?saved=1. Nothing here is required for the page to work.
(function () {
  'use strict';

  // --- Toasts ---------------------------------------------------------------
  function ensureToastWrap() {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function toast(message, kind) {
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'toast-item ' + (kind || 'success');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add('toast-hide'); setTimeout(() => el.remove(), 300); }, 4000);
  }

  // --- Fetch helpers ----------------------------------------------------------
  async function readError(res) {
    try {
      const j = await res.clone().json();
      if (j && j.error) return j.error;
    } catch {}
    try { const t = await res.text(); return t.slice(0, 200) || `Request failed (${res.status})`; } catch { return `Request failed (${res.status})`; }
  }

  // A 200 that is not JSON is never a successful API answer — it is the
  // login page (or another HTML page) that fetch followed a redirect to.
  // Refuse it so a silent "success" can never again hide a failed delete.
  function assertJson(res) {
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('Unexpected response from the server — your session may have expired, please log in again.');
  }

  async function postJSON(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await readError(res));
    assertJson(res);
    return res.json().catch(() => ({}));
  }

  async function getJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(await readError(res));
    assertJson(res);
    return res.json();
  }

  async function del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await readError(res));
    assertJson(res);
    return res.json().catch(() => ({}));
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  // --- Forms ------------------------------------------------------------------
  // FormData -> plain object. Unchecked checkboxes become false (the server
  // treats a missing key as "not in this form", so explicit false matters
  // for toggles). levelRoles (a JSON text field) is parsed, with a clear
  // error instead of a silent bad save.
  function formToJSON(form) {
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    form.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      if (!(cb.name in data)) data[cb.name] = false;
      else if (cb.value === 'true' || cb.value === 'on') data[cb.name] = true;
    });
    if (typeof data.levelRoles === 'string') {
      try { data.levelRoles = JSON.parse(data.levelRoles); }
      catch { throw new Error('levelRoles must be valid JSON'); }
    }
    return data;
  }

  // Intercept API forms (action starts with /api/) — save via fetch, toast,
  // no page reload. Forms with data-plain-submit are left alone.
  function bindApiForms() {
    document.querySelectorAll('form[action^="/api/"]:not([data-plain-submit])').forEach((form) => {
      if (form.dataset.acebotBound) return;
      form.dataset.acebotBound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const original = btn ? btn.textContent : '';
        if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
        try {
          const data = formToJSON(form);
          await postJSON(form.action, data);
          toast(form.dataset.successMessage || 'Settings saved');
          form.dispatchEvent(new CustomEvent('acebot:saved', { bubbles: true }));
        } catch (err) {
          toast('Save failed: ' + err.message, 'error');
        } finally {
          if (btn) { btn.textContent = original; btn.disabled = false; }
        }
      });
    });
  }

  // --- Section refresh ---------------------------------------------------------
  // Re-fetch the current page as HTML and swap one container's content,
  // so lists (streamers, suggestions, errors, bot flags…) update without a
  // full reload. Returns true on success. Page modules use event delegation,
  // so swapped-in buttons keep working without re-binding.
  async function refreshSection(selector) {
    try {
      const res = await fetch(window.location.href, { headers: { Accept: 'text/html' } });
      if (!res.ok) return false;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fresh = doc.querySelector(selector);
      const current = document.querySelector(selector);
      if (!fresh || !current) return false;
      current.replaceWith(fresh);
      return true;
    } catch {
      return false;
    }
  }

  // Remove a table row / card from the DOM after a successful delete.
  function removeRow(el) {
    const row = el.closest('tr, .card, [data-row]');
    if (row) row.remove();
  }

  // Repeat fn every ms while the tab is visible (used for staff overview stats).
  function refreshEvery(ms, fn) {
    const tick = () => { if (!document.hidden) fn().catch(() => {}); };
    tick();
    return setInterval(tick, ms);
  }

  // Escape text for insertion into innerHTML templates.
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Welcome image preview (1.3.6): fetch the sample card PNG and show it.
  function bindWelcomePreview() {
    const btn = document.getElementById('welcome-preview-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const box = document.getElementById('welcome-preview-img');
      const m = window.location.pathname.match(/\/guilds\/([^/]+)/);
      if (!box || !m) return;
      btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const res = await fetch(`/api/guilds/${m[1]}/welcome-preview`);
        if (!res.ok) throw new Error('preview failed');
        const blob = await res.blob();
        box.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.style.maxWidth = '100%';
        img.alt = 'Sample welcome card';
        box.appendChild(img);
      } catch {
        toast('Preview failed — is canvas installed on the host?', 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Preview sample card';
      }
    });
  }

  window.AceBot = { toast, postJSON, getJSON, del, confirmAction, formToJSON, bindApiForms, refreshSection, removeRow, refreshEvery, esc };

  document.addEventListener('DOMContentLoaded', () => { bindApiForms(); bindWelcomePreview(); });
})();
