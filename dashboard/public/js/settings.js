// Per-server settings page (dashboard/views/settings.ejs).
// All list mutations go through fetch + toast, then either remove the row
// from the DOM or refresh just that list's container (AceBot.refreshSection
// re-fetches this page's HTML and swaps one element — no full reload).
// Handlers use event delegation on document, so buttons inside a refreshed
// container keep working without re-binding. The generic settings forms
// (action=/api/...) are handled by app.js (toast "Settings saved").
(function () {
  'use strict';
  const guildId = (window.ACEBOT_PAGE && window.ACEBOT_PAGE.guildId) || '';
  const api = (p) => `/api/guilds/${guildId}${p}`;

  function showResult(id, msg, ok) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    if (ok) AceBot.toast(msg.replace(/^❌ /, ''));
  }

  // --- Live previews (update as you type) ---
  function initPreviews() {
    const tplInput = document.getElementById('template-input');
    const tplPreview = document.getElementById('template-preview');
    const updateTpl = () => {
      if (!tplInput || !tplPreview) return;
      tplPreview.textContent = (tplInput.value || '🔴 LIVE: {name}')
        .replaceAll('{name}', 'ExampleStreamer').replaceAll('{game}', 'Just Chatting').replaceAll('{title}', 'Chilling with chat');
    };
    if (tplInput) { tplInput.addEventListener('input', updateTpl); updateTpl(); }

    const welcomePreview = (text) => (text || 'Welcome to {server}, {user}! You are member #{membercount}.')
      .replaceAll('{user}', '@Ace').replaceAll('{username}', 'Ace')
      .replaceAll('{server}', 'Your Server').replaceAll('{membercount}', '42');
    const wTpl = document.getElementById('welcome-template');
    const wPrev = document.getElementById('welcome-preview');
    if (wTpl && wPrev) { wTpl.addEventListener('input', () => { wPrev.textContent = welcomePreview(wTpl.value); }); wPrev.textContent = welcomePreview(wTpl.value); }
    const gTpl = document.getElementById('goodbye-template');
    const gPrev = document.getElementById('goodbye-preview');
    if (gTpl && gPrev) { gTpl.addEventListener('input', () => { gPrev.textContent = welcomePreview(gTpl.value); }); gPrev.textContent = welcomePreview(gTpl.value); }
    const dmTestBtn = document.getElementById('welcome-dm-test-btn');
    const dmTestResult = document.getElementById('welcome-dm-test-result');
    if (dmTestBtn) dmTestBtn.addEventListener('click', async () => {
      dmTestBtn.disabled = true;
      if (dmTestResult) dmTestResult.textContent = 'Sending…';
      try { await AceBot.postJSON(api('/welcome-dm-test'), {}); if (dmTestResult) dmTestResult.textContent = '✅ Test DM sent — check your DMs.'; }
      catch (err) { if (dmTestResult) dmTestResult.textContent = '❌ ' + err.message; }
      dmTestBtn.disabled = false;
    });
  }

  // --- Submit handlers (delegated) ---
  async function handleSubmit(e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    const id = form.id;
    const handlers = {
      'add-streamer-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/streamers'), Object.fromEntries(fd));
        AceBot.toast('Streamer added');
        await AceBot.refreshSection('#streamers-list');
        form.reset();
      },
      'create-app-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/applications/forms'), {
          name: fd.get('name'), description: fd.get('description'),
          questions: String(fd.get('questions')).split('\n'),
          roleToGrant: fd.get('roleToGrant') || null, reviewChannelId: fd.get('reviewChannelId'),
        });
        AceBot.toast('Application form created');
        await AceBot.refreshSection('#app-forms-list');
        form.reset();
      },
      'automod-form': async () => {
        const fd = new FormData(form);
        const body = {
          enabled: fd.get('enabled') === 'true',
          spamMaxMessages: parseInt(fd.get('spamMaxMessages'), 10),
          spamWindowSeconds: parseInt(fd.get('spamWindowSeconds'), 10),
          spamAction: fd.get('spamAction'),
          spamTimeoutMinutes: parseInt(fd.get('spamTimeoutMinutes'), 10),
          blockLinks: fd.get('blockLinks') === 'true',
          blockInvites: fd.get('blockInvites') === 'true',
          logChannelId: fd.get('logChannelId') || '',
          bannedWords: String(fd.get('bannedWords') || '').split('\n'),
          exemptRoles: fd.getAll('exemptRoles'),
          exemptChannels: fd.getAll('exemptChannels'),
        };
        await AceBot.postJSON(api('/automod'), body);
        const status = document.getElementById('automod-status');
        if (status) status.innerHTML = `Automod is currently <strong>${body.enabled ? '✅ enabled' : '❌ disabled'}</strong> in this server.`;
        AceBot.toast('Settings saved');
      },
      'add-shop-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/shop'), Object.fromEntries(fd));
        AceBot.toast('Shop item added');
        await AceBot.refreshSection('#shop-list');
        form.reset();
      },
      'add-custom-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/custom-commands'), Object.fromEntries(fd));
        AceBot.toast('Custom command added');
        await AceBot.refreshSection('#custom-list');
        form.reset();
      },
      'add-faq-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/faq'), Object.fromEntries(fd));
        AceBot.toast('FAQ response added');
        await AceBot.refreshSection('#faq-list');
        form.reset();
      },
      // 1.11.x: ticket panels, invite role rules, countdowns, emojis.
      'add-ticket-panel-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/ticket-panels'), Object.fromEntries(fd));
        AceBot.toast('Ticket panel created');
        await AceBot.refreshSection('#ticket-panels-list');
        form.reset();
      },
      'add-invite-role-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/invite-roles'), Object.fromEntries(fd));
        AceBot.toast('Invite role rule added');
        await AceBot.refreshSection('#invite-roles-list');
        form.reset();
      },
      'add-countdown-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/countdowns'), Object.fromEntries(fd));
        AceBot.toast('Countdown created');
        await AceBot.refreshSection('#countdowns-list');
        form.reset();
      },
      'rules-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/rules'), { title: fd.get('title'), content: fd.get('content'), channelId: fd.get('channelId') });
        AceBot.toast('Rules saved & posted');
        await AceBot.refreshSection('#rules-result');
      },
      'add-emoji-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/emojis'), Object.fromEntries(fd));
        AceBot.toast('Emoji uploaded');
        await AceBot.refreshSection('#emojis-list');
        form.reset();
      },
      // 1.7.x / 1.8.x: events, slowmode schedules, status roles, invite rewards.
      'add-event-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/events'), {
          title: fd.get('title'), description: fd.get('description') || null,
          channelId: fd.get('channelId'), startsAt: fd.get('startsAt'),
        });
        AceBot.toast('Event created');
        await AceBot.refreshSection('#events-list');
        form.reset();
      },
      'add-slowmode-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/slowmode-schedules'), Object.fromEntries(fd));
        AceBot.toast('Slowmode schedule saved');
        await AceBot.refreshSection('#slowmode-list');
        form.reset();
      },
      'add-statusrole-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/statusroles'), Object.fromEntries(fd));
        AceBot.toast('Status role added');
        await AceBot.refreshSection('#statusrole-list');
        form.reset();
      },
      'add-invitereward-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/inviterewards'), Object.fromEntries(fd));
        AceBot.toast('Invite milestone added');
        await AceBot.refreshSection('#invite-rewards-list');
        form.reset();
      },
      // Auto-publish (1.8.7): the multi-select needs getAll — the generic
      // form handler would keep only the last selected channel.
      'autopublish-form': async () => {
        const fd = new FormData(form);
        await AceBot.postJSON(api('/settings'), { autopublishChannels: fd.getAll('autopublishChannels') });
        AceBot.toast('Auto-publish channels saved');
      },
    };
    if (!handlers[id]) return; // generic API forms are handled by app.js
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try { await handlers[id](); }
    catch (err) {
      const resultIds = { 'add-streamer-form': 'streamer-result', 'create-app-form': 'app-form-result', 'automod-form': 'automod-result', 'add-shop-form': 'shop-result', 'add-custom-form': 'custom-result', 'add-faq-form': 'faq-result', 'add-ticket-panel-form': 'ticket-panel-result', 'add-invite-role-form': 'invite-role-result', 'add-countdown-form': 'countdown-result', 'add-emoji-form': 'emoji-result', 'rules-form': 'rules-result', 'add-event-form': 'event-result', 'add-slowmode-form': 'slowmode-result', 'add-statusrole-form': 'statusrole-result', 'add-invitereward-form': 'invitereward-result' };
      showResult(resultIds[id], '❌ ' + err.message, false);
      AceBot.toast('Failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.textContent = original; btn.disabled = false; }
    }
  }

  // --- Click handlers (delegated) ---
  async function handleClick(e) {
    const refreshBtn = e.target.closest('[data-refresh-section]');
    if (refreshBtn) {
      refreshBtn.textContent = 'Refreshing…';
      const ok = await AceBot.refreshSection(refreshBtn.dataset.refreshSection);
      AceBot.toast(ok ? 'Refreshed' : 'Refresh failed — reload the page to retry', ok ? 'success' : 'error');
      if (!ok) refreshBtn.textContent = '🔄 Refresh';
      return;
    }
    const editBtn = e.target.closest('[data-edit-streamer]');
    if (editBtn) {
      const row = document.getElementById('edit-row-' + editBtn.dataset.editStreamer);
      if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
      return;
    }
    const rmStreamer = e.target.closest('[data-remove-streamer]');
    if (rmStreamer) {
      if (!AceBot.confirmAction('Remove this streamer?')) return;
      try {
        await AceBot.del(api(`/streamers/${rmStreamer.dataset.removeStreamer}`));
        AceBot.removeRow(rmStreamer);
        // The hidden edit row is a separate <tr> — remove it too, or it
        // lingers in the DOM after its streamer row is gone.
        document.getElementById('edit-row-' + rmStreamer.dataset.removeStreamer)?.remove();
        AceBot.toast('Streamer removed');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const refStreamer = e.target.closest('[data-refresh-streamer]');
    if (refStreamer) {
      refStreamer.textContent = 'Checking…';
      try {
        const j = await AceBot.postJSON(api(`/streamers/${refStreamer.dataset.refreshStreamer}/refresh`), {});
        AceBot.toast(j.live ? `🔴 LIVE${j.title ? ' — ' + j.title : ''}` : '⚫ Offline right now.', j.live ? 'success' : 'info');
        await AceBot.refreshSection('#streamers-list');
      } catch (err) { AceBot.toast('Check failed: ' + err.message, 'error'); refStreamer.textContent = 'Refresh'; }
      return;
    }
    const pvStreamer = e.target.closest('[data-preview-streamer]');
    if (pvStreamer) {
      pvStreamer.textContent = 'Loading…';
      try {
        const j = await AceBot.getJSON(api(`/streamers/${pvStreamer.dataset.previewStreamer}/preview`));
        renderStreamPreview(j);
      } catch (err) { AceBot.toast('Preview failed: ' + err.message, 'error'); }
      finally { pvStreamer.textContent = 'Preview'; }
      return;
    }
    const closePreview = e.target.closest('[data-close-stream-preview]');
    if (closePreview) {
      const box = document.getElementById('stream-preview');
      if (box) { box.style.display = 'none'; box.innerHTML = ''; }
      return;
    }
    const appToggle = e.target.closest('[data-app-form-toggle]');
    if (appToggle) {
      try {
        const res = await fetch(api(`/applications/forms/${appToggle.dataset.appFormToggle}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOpen: appToggle.dataset.appFormOpen === '1' }) });
        if (!res.ok) throw new Error(await res.text());
        AceBot.toast(appToggle.dataset.appFormOpen === '1' ? 'Form opened' : 'Form closed');
        await AceBot.refreshSection('#app-forms-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const appReview = e.target.closest('[data-app-review]');
    if (appReview) {
      const note = document.getElementById('note-' + appReview.dataset.appReview)?.value || '';
      try {
        await AceBot.postJSON(api(`/applications/${appReview.dataset.appReview}/review`), { decision: appReview.dataset.appDecision, note });
        AceBot.toast(`Application ${appReview.dataset.appDecision}`);
        await AceBot.refreshSection('#app-queue-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const suggFilter = e.target.closest('[data-sugg-filter]');
    if (suggFilter) {
      const status = suggFilter.dataset.suggFilter;
      try {
        const rows = await AceBot.getJSON(api(`/suggestions${status ? '?status=' + status : ''}`));
        renderSuggestions(rows);
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const suggReview = e.target.closest('[data-sugg-review]');
    if (suggReview) {
      try {
        await AceBot.postJSON(api(`/suggestions/${suggReview.dataset.suggReview}/review`), { decision: suggReview.dataset.suggDecision });
        AceBot.toast(`Suggestion ${suggReview.dataset.suggDecision}`);
        await AceBot.refreshSection('#suggestions-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const rmShop = e.target.closest('[data-remove-shop]');
    if (rmShop) {
      if (!AceBot.confirmAction('Remove this shop item?')) return;
      try { await AceBot.del(api(`/shop/${rmShop.dataset.removeShop}`)); AceBot.removeRow(rmShop); AceBot.toast('Shop item removed'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const rmCustom = e.target.closest('[data-remove-custom]');
    if (rmCustom) {
      if (!AceBot.confirmAction(`Remove custom command "${rmCustom.dataset.removeCustom}"?`)) return;
      try { await AceBot.del(api(`/custom-commands/${encodeURIComponent(rmCustom.dataset.removeCustom)}`)); AceBot.removeRow(rmCustom); AceBot.toast('Custom command removed'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const rmFaq = e.target.closest('[data-remove-faq]');
    if (rmFaq) {
      if (!AceBot.confirmAction('Remove this FAQ response?')) return;
      try { await AceBot.del(api(`/faq/${rmFaq.dataset.removeFaq}`)); AceBot.removeRow(rmFaq); AceBot.toast('FAQ response removed'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const cancelSched = e.target.closest('[data-cancel-scheduled]');
    if (cancelSched) {
      if (!AceBot.confirmAction('Cancel this scheduled message?')) return;
      try { await AceBot.del(api(`/scheduled/${cancelSched.dataset.cancelScheduled}`)); AceBot.removeRow(cancelSched); AceBot.toast('Scheduled message cancelled'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    // Generic delete / post buttons (color roles, MC widgets, modmail…).
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      if (!AceBot.confirmAction('Are you sure?')) return;
      try { await AceBot.del(delBtn.dataset.delete); AceBot.removeRow(delBtn); AceBot.toast('Removed'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const postBtn = e.target.closest('[data-post]');
    if (postBtn) {
      if (!AceBot.confirmAction('Are you sure?')) return;
      let body = {};
      if (postBtn.dataset.postBody) { try { body = JSON.parse(postBtn.dataset.postBody); } catch {} }
      try { await AceBot.postJSON(postBtn.dataset.post, body); AceBot.removeRow(postBtn); AceBot.toast('Done'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
  }

  function suggCard(s) {
    const pending = s.status === 'pending';
    return `<div class="card" style="text-align:left;margin-bottom:12px"><strong>#${AceBot.esc(s.id)} — ${AceBot.esc(s.title)}</strong> · &lt;@${AceBot.esc(s.user_id)}&gt; · ${AceBot.esc(s.status)} · 👍 ${s.votes_up} · 👎 ${s.votes_down}<br><p>${AceBot.esc(s.text)}</p>${pending ? `<button class="btn green" data-sugg-review="${s.id}" data-sugg-decision="approved">✅ Approve</button> <button class="btn danger" data-sugg-review="${s.id}" data-sugg-decision="denied">❌ Deny</button> <button class="btn" data-sugg-review="${s.id}" data-sugg-decision="implemented">🚀 Mark implemented</button>` : ''}</div>`;
  }

  function renderSuggestions(rows) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map(suggCard).join('') : '<p class="muted">No suggestions with that status.</p>';
  }

  // --- Commands tab (JS-driven list + immediate toggles) ---
  async function initCommandsTab() {
    const cmdList = document.getElementById('commands-list');
    if (!cmdList) return;
    try {
      const rows = await AceBot.getJSON(api('/commands'));
      let html = '<table><tr><th>Command</th><th>Category</th><th>Enabled in this server</th></tr>';
      rows.forEach((c) => {
        html += `<tr><td>/${AceBot.esc(c.name)}</td><td>${AceBot.esc(c.category)}</td><td>${c.globallyDisabled ? 'Disabled globally by staff' : `<label class="toggle"><input type="checkbox" data-guild-command="${AceBot.esc(c.name)}" ${c.enabled ? 'checked' : ''}><span class="track"></span></label>`}</td></tr>`;
      });
      cmdList.innerHTML = html + '</table>';
    } catch { cmdList.innerHTML = '<p class="muted">Could not load commands.</p>'; }
  }

  async function handleChange(e) {
    const clip = e.target.closest('[data-clip-toggle]');
    if (clip) {
      try {
        await AceBot.postJSON(api(`/streamers/${clip.dataset.clipToggle}/clip`), { enabled: clip.checked });
        AceBot.toast(clip.checked ? 'Clips will be attached to live announcements' : 'Clips off for this streamer');
      } catch (err) { AceBot.toast('Failed to save.', 'error'); clip.checked = !clip.checked; }
      return;
    }
    const cb = e.target.closest('[data-guild-command]');
    if (!cb) return;
    try {
      await AceBot.postJSON(api('/commands'), { commandName: cb.dataset.guildCommand, enabled: cb.checked });
      AceBot.toast(`/${cb.dataset.guildCommand} ${cb.checked ? 'enabled' : 'disabled'} in this server`);
    } catch (err) { AceBot.toast('Failed to save.', 'error'); cb.checked = !cb.checked; }
  }

  // Edit-streamer forms live inside the (refreshable) streamers list.
  async function handleEditSubmit(e) {
    const form = e.target;
    if (!form.classList || !form.classList.contains('edit-streamer-form')) return;
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const res = await fetch(api(`/streamers/${form.dataset.streamerId}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fd)) });
      if (!res.ok) throw new Error(await res.text());
      AceBot.toast('Streamer updated');
      await AceBot.refreshSection('#streamers-list');
    } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
  }

  // Edit-embed forms (1.7.8) live inside the embeds list — one per embed.
  async function handleEmbedEditSubmit(e) {
    const form = e.target;
    if (!form.classList || !form.classList.contains('edit-embed-form')) return;
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      await AceBot.postJSON(api(`/embeds/${form.dataset.messageId}/edit`), Object.fromEntries(fd));
      AceBot.toast('Embed updated');
    } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
    finally { if (btn) { btn.textContent = original; btn.disabled = false; } }
  }

  // Stream announcement preview (1.15.24): renders the preview route's
  // content + embed JSON as a Discord-style message. Preview only — the
  // route never sends anything, and neither does this. All text from the
  // server is escaped; only Discord's own **bold** and [text](url) markdown
  // in embed field values is rendered.
  function renderStreamPreview(data) {
    const box = document.getElementById('stream-preview');
    if (!box || !data || !data.embed) return;
    const e = data.embed;
    const esc = AceBot.esc;
    const md = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const color = '#' + (e.color ?? 0x5865f2).toString(16).padStart(6, '0');
    const fields = (e.fields || []).map((f) => `<div class="dp-field${f.inline ? ' inline' : ''}"><div class="dp-field-name">${esc(f.name)}</div><div class="dp-field-value">${md(f.value)}</div></div>`).join('');
    let when = '';
    if (e.timestamp) {
      const d = new Date(e.timestamp);
      const today = new Date();
      const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      when = d.toDateString() === today.toDateString()
        ? `Today at ${time}`
        : `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} at ${time}`;
    }
    const title = e.url
      ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || '')}</a>`
      : esc(e.title || '');
    box.innerHTML = `<div class="dp-note"><span>🔍 Preview — nothing was sent to Discord.</span><button class="btn ghost" type="button" data-close-stream-preview>✕ Close</button></div>`
      + `<div class="dp-message"><div class="dp-content">${md(data.content || '')}</div>`
      + `<div class="dp-embed" style="border-left-color:${color}">`
      + `<div class="dp-title">${title}</div>`
      + (e.description ? `<div class="dp-desc">${md(e.description)}</div>` : '')
      + (fields ? `<div class="dp-fields">${fields}</div>` : '')
      + (e.image && e.image.url ? `<img class="dp-image" src="${esc(e.image.url)}" alt="Stream thumbnail">` : '')
      + (when ? `<div class="dp-footer">${esc(when)}</div>` : '')
      + '</div></div>';
    box.style.display = '';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Rank card preview (1.8.9): fetch the sample card PNG and show it.
  function bindRankcardPreview() {
    const btn = document.getElementById('rankcard-preview-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const box = document.getElementById('rankcard-preview-img');
      const m = window.location.pathname.match(/\/guilds\/([^/]+)/);
      if (!box || !m) return;
      btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const res = await fetch(`/api/guilds/${m[1]}/rankcard-preview`);
        if (!res.ok) throw new Error('preview failed');
        const blob = await res.blob();
        box.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.style.maxWidth = '100%';
        img.alt = 'Sample rank card';
        box.appendChild(img);
      } catch {
        AceBot.toast('Preview failed — is canvas installed on the host?', 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Preview sample rank card';
      }
    });
  }

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('submit', handleEditSubmit);
  document.addEventListener('submit', handleEmbedEditSubmit);
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  initPreviews();
  initCommandsTab();
  bindRankcardPreview();
})();
