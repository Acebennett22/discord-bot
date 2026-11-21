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

  // --- Reaction-role multi-row form (1.15.33) ---
  function updateRrRemoveButtons() {
    const container = document.getElementById('rr-rows');
    if (!container) return;
    const rows = container.querySelectorAll('[data-rr-row]');
    rows.forEach((row) => { const b = row.querySelector('[data-rr-remove]'); if (b) b.style.display = rows.length > 1 ? '' : 'none'; });
    const addBtn = document.getElementById('rr-add-row');
    if (addBtn) addBtn.disabled = rows.length >= 25;
  }
  function updateRrSelectedButton() {
    const btn = document.getElementById('rr-remove-selected');
    if (!btn) return;
    btn.disabled = !document.querySelector('.rr-select:checked');
  }
  function resetReactionRoleRows() {
    const container = document.getElementById('rr-rows');
    const form = document.getElementById('add-reaction-role-form');
    if (!container || !form) return;
    form.reset();
    container.querySelectorAll('[data-rr-row]').forEach((row, i) => { if (i > 0) row.remove(); });
    updateRrRemoveButtons();
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
      // 1.15.33: one row posts the single shape (unchanged 1.15.32
      // behavior); several rows post { mappings: [...] } and the per-row
      // results are rendered into #reaction-role-result.
      'add-reaction-role-form': async () => {
        const rows = [...form.querySelectorAll('[data-rr-row]')].map((row) => ({
          channelId: row.querySelector('[name=channelId]').value,
          messageId: row.querySelector('[name=messageId]').value.trim(),
          emojiCustom: row.querySelector('[name=emojiCustom]').value,
          emojiUnicode: row.querySelector('[name=emojiUnicode]').value.trim(),
          roleId: row.querySelector('[name=roleId]').value,
        }));
        if (rows.length === 1) {
          await AceBot.postJSON(api('/reaction-roles'), rows[0]);
          AceBot.toast('Reaction role added');
        } else {
          const j = await AceBot.postJSON(api('/reaction-roles'), { mappings: rows });
          const lines = j.results.map((r, i) => (r.ok
            ? `✅ Row ${i + 1}: ${r.emoji} → ${r.roleName}`
            : `❌ Row ${i + 1}: ${r.error}`));
          const el = document.getElementById('reaction-role-result');
          if (el) el.innerHTML = lines.map((l) => AceBot.esc(l)).join('<br>');
          AceBot.toast(`${j.saved} added${j.failed ? `, ${j.failed} failed` : ''}`, j.failed ? 'error' : 'success');
        }
        await AceBot.refreshSection('#reaction-roles-list');
        resetReactionRoleRows();
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
      // Bot identity (1.16.8): nickname + prefix (JSON), and the avatar
      // picture (raw file bytes — the route uses express.raw, not
      // multipart, so the file goes up as the request body).
      'identity-form': async () => {
        const fd = new FormData(form);
        const j = await AceBot.postJSON(api('/identity'), { nickname: fd.get('nickname'), prefix: fd.get('prefix') });
        const result = document.getElementById('identity-result');
        if (result) result.textContent = (j.warnings || []).length ? '⚠️ ' + j.warnings.join(' ') : '✅ Saved.';
        AceBot.toast((j.warnings || []).length ? 'Saved with a warning' : 'Bot identity saved');
        await AceBot.refreshSection('#identity-block');
      },
      'identity-avatar-form': async () => {
        const file = form.querySelector('#identity-avatar-file')?.files?.[0];
        if (!file) throw new Error('Choose a picture first.');
        const res = await fetch(api('/identity/avatar'), { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || ('Upload failed (' + res.status + ')'));
        const preview = document.getElementById('identity-avatar-preview');
        if (preview && j.avatarUrl) preview.src = j.avatarUrl;
        const result = document.getElementById('identity-avatar-result');
        if (result) result.textContent = j.warning ? '⚠️ ' + j.warning : '✅ Picture updated.';
        AceBot.toast(j.warning || 'Picture updated');
        await AceBot.refreshSection('#identity-block');
        form.reset();
      },
    };
    if (!handlers[id]) return; // generic API forms are handled by app.js
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try { await handlers[id](); }
    catch (err) {
      const resultIds = { 'add-streamer-form': 'streamer-result', 'create-app-form': 'app-form-result', 'automod-form': 'automod-result', 'add-shop-form': 'shop-result', 'add-custom-form': 'custom-result', 'add-faq-form': 'faq-result', 'add-ticket-panel-form': 'ticket-panel-result', 'add-invite-role-form': 'invite-role-result', 'add-reaction-role-form': 'reaction-role-result', 'add-countdown-form': 'countdown-result', 'add-emoji-form': 'emoji-result', 'rules-form': 'rules-result', 'add-event-form': 'event-result', 'add-slowmode-form': 'slowmode-result', 'add-statusrole-form': 'statusrole-result', 'add-invitereward-form': 'invitereward-result', 'identity-form': 'identity-result', 'identity-avatar-form': 'identity-avatar-result' };
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
    // Reaction roles (1.15.33): multi-row add form + remove (single/bulk).
    const rrAddRow = e.target.closest('#rr-add-row');
    if (rrAddRow) {
      const container = document.getElementById('rr-rows');
      if (!container) return;
      const rows = container.querySelectorAll('[data-rr-row]');
      if (rows.length >= 25) { AceBot.toast('At most 25 mappings at once', 'error'); return; }
      const clone = rows[0].cloneNode(true);
      clone.querySelectorAll('input[type=text]').forEach((i) => { i.value = ''; });
      clone.querySelectorAll('select').forEach((s) => { s.selectedIndex = 0; });
      container.appendChild(clone);
      updateRrRemoveButtons();
      return;
    }
    const rrRemoveRow = e.target.closest('[data-rr-remove]');
    if (rrRemoveRow) {
      const container = document.getElementById('rr-rows');
      if (!container || container.querySelectorAll('[data-rr-row]').length <= 1) return;
      rrRemoveRow.closest('[data-rr-row]').remove();
      updateRrRemoveButtons();
      return;
    }
    const rrRemoveOne = e.target.closest('[data-remove-reaction-role]');
    if (rrRemoveOne) {
      if (!AceBot.confirmAction('Remove this reaction role?')) return;
      try {
        const j = await AceBot.del(api(`/reaction-roles/${rrRemoveOne.dataset.removeReactionRole}`));
        AceBot.toast(j.messageGone ? 'Reaction role removed (its message is already gone)' : 'Reaction role removed');
        await AceBot.refreshSection('#reaction-roles-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const rrSelectAll = e.target.closest('#rr-select-all');
    if (rrSelectAll) {
      document.querySelectorAll('.rr-select').forEach((cb) => { cb.checked = rrSelectAll.checked; });
      updateRrSelectedButton();
      return;
    }
    const rrSelect = e.target.closest('.rr-select');
    if (rrSelect) { updateRrSelectedButton(); return; }
    const rrRemoveSelected = e.target.closest('#rr-remove-selected');
    if (rrRemoveSelected) {
      const ids = [...document.querySelectorAll('.rr-select:checked')].map((cb) => cb.value);
      if (!ids.length) return;
      if (!AceBot.confirmAction(`Remove ${ids.length} reaction role${ids.length === 1 ? '' : 's'}?`)) return;
      rrRemoveSelected.disabled = true;
      try {
        const j = await AceBot.postJSON(api('/reaction-roles/bulk-delete'), { ids });
        const notFound = j.results.filter((r) => !r.ok).length;
        AceBot.toast(`${j.removed} removed${notFound ? `, ${notFound} already gone` : ''}`, notFound ? 'error' : 'success');
        await AceBot.refreshSection('#reaction-roles-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      finally { updateRrSelectedButton(); }
      return;
    }
    const rrRefresh = e.target.closest('[data-refresh-reaction-roles]');
    if (rrRefresh) {
      const channelId = rrRefresh.dataset.rrChannel;
      const messageId = rrRefresh.dataset.rrMessage;
      rrRefresh.disabled = true;
      try {
        const j = await AceBot.postJSON(api('/reaction-roles/refresh'), { channelId, messageId });
        AceBot.toast(`Buttons refreshed — ${j.count} role${j.count === 1 ? '' : 's'} re-applied`);
      } catch (err) { AceBot.toast('Refresh failed: ' + err.message, 'error'); }
      finally { rrRefresh.disabled = false; }
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
    // Bot identity avatar reset (1.16.8): restores the global picture.
    const identResetBtn = e.target.closest('#identity-avatar-reset');
    if (identResetBtn) {
      if (!AceBot.confirmAction('Reset the bot\'s picture in this server back to its global picture?')) return;
      identResetBtn.disabled = true;
      try {
        const j = await AceBot.postJSON(api('/identity/avatar/reset'), {});
        const preview = document.getElementById('identity-avatar-preview');
        if (preview && j.avatarUrl) preview.src = j.avatarUrl;
        const result = document.getElementById('identity-avatar-result');
        if (result) result.textContent = '✅ Picture reset to the global one.';
        AceBot.toast('Picture reset');
        await AceBot.refreshSection('#identity-block');
      } catch (err) {
        const result = document.getElementById('identity-avatar-result');
        if (result) result.textContent = '❌ ' + err.message;
        AceBot.toast('Failed: ' + err.message, 'error');
      } finally {
        identResetBtn.disabled = false;
      }
      return;
    }
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      if (!AceBot.confirmAction('Are you sure?')) return;
      try { await AceBot.del(delBtn.dataset.delete); AceBot.removeRow(delBtn); AceBot.toast('Removed'); }
      catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    // Ticket panel repost (1.15.28): deletes the old panel message and posts
    // a fresh one in the same channel with the current settings.
    const repostBtn = e.target.closest('[data-repost-panel]');
    if (repostBtn) {
      if (!AceBot.confirmAction('Repost this ticket panel? The old panel message will be deleted and a fresh one posted in the same channel.')) return;
      try { await AceBot.postJSON(repostBtn.dataset.repostPanel); await AceBot.refreshSection('#ticket-panels-list'); AceBot.toast('Ticket panel reposted'); }
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
    // Bot identity tab (1.16.8): preview the chosen picture locally
    // before upload — the upload itself is the form's submit handler.
    if (e.target && e.target.id === 'identity-avatar-file') {
      const file = e.target.files && e.target.files[0];
      const preview = document.getElementById('identity-avatar-preview');
      if (file && preview) {
        const reader = new FileReader();
        reader.onload = () => { preview.src = reader.result; };
        reader.readAsDataURL(file);
      }
      return;
    }
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

  // --- Embed Creator (1.15.31): shared composer, per-server page. ---
  // Same form + live preview as the staff page; the guild is fixed
  // (this page) and the channel select is server-rendered.
  if (window.AceBotEmbedCreator) {
    window.AceBotEmbedCreator.init({ sendUrl: api('/embed-creator'), guildId });
  }
})();
