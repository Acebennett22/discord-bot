// Staff area (dashboard/views/staff.ejs).
// Toggles apply immediately; deletes confirm + remove the row from the DOM;
// lists refresh via fetch (AceBot.refreshSection) instead of full reloads;
// the overview stats auto-refresh every 30s from /api/staff/overview.
// Handlers use event delegation so refreshed sections keep working.
(function () {
  'use strict';

  // --- Toggles (commands / features): immediate, revert on failure ---
  document.querySelectorAll('input[data-command]').forEach((cb) => cb.addEventListener('change', async () => {
    try {
      await AceBot.postJSON('/api/staff/commands', { commandName: cb.dataset.command, enabled: cb.checked });
      AceBot.toast(`/${cb.dataset.command} ${cb.checked ? 'enabled' : 'disabled'} globally`);
    } catch (e) { AceBot.toast('Failed: ' + e.message, 'error'); cb.checked = !cb.checked; }
  }));
  document.querySelectorAll('input[data-feature]').forEach((cb) => cb.addEventListener('change', async () => {
    try {
      await AceBot.postJSON('/api/staff/features', { feature: cb.dataset.feature, enabled: cb.checked });
      AceBot.toast(`${cb.dataset.feature} ${cb.checked ? 'enabled' : 'disabled'}`);
    } catch (e) { AceBot.toast('Failed: ' + e.message, 'error'); cb.checked = !cb.checked; }
  }));

  // --- Overview auto-refresh (30s) ---
  const overviewEls = document.querySelectorAll('[data-overview]');
  if (overviewEls.length) {
    AceBot.refreshEvery(30_000, async () => {
      const d = await AceBot.getJSON('/api/staff/overview');
      const set = (key, value) => {
        const el = document.querySelector(`[data-overview="${key}"]`);
        if (el) el.textContent = value;
      };
      set('guilds', d.guilds ?? '—');
      set('errors24h', d.errors24h ?? '—');
      set('commandsUsed', d.commandsUsed ?? '—');
      set('joinsToday', d.joinsToday ?? '—');
      set('flaggedToday', d.flaggedToday ?? '—');
      set('presence', d.presence ? `${d.presence.current_type || ''} ${d.presence.current_text || ''}` : '—');
    });
  }

  // --- Submit handlers (delegated) ---
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.id === 'add-staff-form') {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await AceBot.postJSON('/api/staff/users', { userId: fd.get('userId'), role: fd.get('role') });
        AceBot.toast('Staff member added');
        form.reset();
        await AceBot.refreshSection('#staff-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (form.id === 'add-account-form') {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await AceBot.postJSON('/api/staff/accounts', { username: fd.get('username'), password: fd.get('password'), role: fd.get('role') });
        AceBot.toast('Account created');
        form.reset();
        await AceBot.refreshSection('#accounts-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (form.id === 'broadcast-form') {
      e.preventDefault();
      const fd = new FormData(form);
      const out = document.getElementById('broadcast-result');
      if (out) out.textContent = 'Sending…';
      try {
        const r = await AceBot.postJSON('/api/staff/broadcast', { guildId: fd.get('guildId'), channelId: fd.get('channelId'), channelName: fd.get('channelName'), title: fd.get('title'), body: fd.get('body'), confirm: fd.get('confirm') === 'true' });
        if (out) out.textContent = `✅ Sent to ${r.sent} of ${r.attempted} channels.`;
        AceBot.toast(`Broadcast sent to ${r.sent} of ${r.attempted} channels`);
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (form.id === 'presence-templates-form') {
      e.preventDefault();
      const fd = new FormData(form);
      const out = document.getElementById('presence-templates-result');
      if (out) out.textContent = 'Saving…';
      try {
        const r = await AceBot.postJSON('/api/staff/presence/templates', { templates: fd.get('templates') });
        if (out) out.textContent = `✅ Saved ${r.activities.length} template(s) — the bot picks them up on its next rotation.`;
        AceBot.toast('Settings saved');
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (form.id === 'bottracking-settings-form') {
      // Plain POST fallback is /staff/bottracking/settings; with JS, save
      // via the JSON API instead (same validation, no reload).
      e.preventDefault();
      const fd = new FormData(form);
      const out = document.getElementById('bottracking-settings-result');
      if (out) out.textContent = 'Saving…';
      try {
        await AceBot.postJSON('/api/staff/bottracking/settings', {
          guildId: fd.get('guildId'),
          threshold: fd.get('threshold') === '' ? null : parseInt(fd.get('threshold'), 10),
          autoAction: fd.get('autoAction'),
          suspectRoleId: fd.get('suspectRoleId') || '',
        });
        if (out) out.textContent = '✅ Saved.';
        AceBot.toast('Settings saved');
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (form.id === 'serverbackup-create-form') {
      e.preventDefault();
      const fd = new FormData(form);
      const out = document.getElementById('serverbackup-result');
      if (out) out.textContent = 'Creating backup…';
      try {
        const r = await AceBot.postJSON('/api/staff/serverbackups', { guildId: fd.get('guildId'), name: fd.get('name') });
        if (out) out.textContent = `✅ Saved backup #${r.id} (${r.roles} roles, ${r.channels} channels). Reload the page to see it in the list.`;
        AceBot.toast('Server backup created');
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
  });

  // --- Click handlers (delegated) ---
  // --- Account role changes (dashboard accounts section) ---------------
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest ? e.target.closest('[data-account-role]') : null;
    if (!sel) return;
    try {
      await AceBot.postJSON(`/api/staff/accounts/${sel.dataset.accountRole}/role`, { role: sel.value });
      AceBot.toast('Role updated');
    } catch (err) {
      AceBot.toast('Failed: ' + err.message, 'error');
      await AceBot.refreshSection('#accounts-list');
    }
  });

  // --- Error log selection (staff errors section) -------------------------
  // Delegated: #errors-list is swapped by refreshSection, so direct binding
  // would die on refresh. Each table's select-all toggles only its own
  // rows; Purge selected stays disabled until at least one row is checked.
  document.addEventListener('change', (e) => {
    const selectAll = e.target.closest ? e.target.closest('[data-select-all-for]') : null;
    if (selectAll) {
      document.querySelectorAll(`#${selectAll.dataset.selectAllFor} .error-select`).forEach((cb) => { cb.checked = selectAll.checked; });
    }
    if (selectAll || e.target.classList.contains('error-select')) {
      const btn = document.getElementById('purge-selected-errors');
      if (btn) btn.disabled = !document.querySelector('.error-select:checked');
      document.querySelectorAll('[data-select-all-for]').forEach((header) => {
        const boxes = [...document.querySelectorAll(`#${header.dataset.selectAllFor} .error-select`)];
        header.checked = boxes.length > 0 && boxes.every((cb) => cb.checked);
      });
    }
  });

  document.addEventListener('click', async (e) => {
    const refreshBtn = e.target.closest('[data-refresh-section]');
    if (refreshBtn) {
      refreshBtn.textContent = 'Refreshing…';
      const ok = await AceBot.refreshSection(refreshBtn.dataset.refreshSection);
      AceBot.toast(ok ? 'Refreshed' : 'Refresh failed — reload the page to retry', ok ? 'success' : 'error');
      if (!ok) refreshBtn.textContent = '🔄 Refresh';
      return;
    }
    const rmStaff = e.target.closest('[data-remove-staff]');
    if (rmStaff) {
      if (!AceBot.confirmAction('Remove this staff member?')) return;
      try {
        await AceBot.del('/api/staff/users/' + rmStaff.dataset.removeStaff);
        AceBot.removeRow(rmStaff);
        AceBot.toast('Staff member removed');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const accEnable = e.target.closest('[data-account-enable]');
    if (accEnable) {
      try {
        await AceBot.postJSON(`/api/staff/accounts/${accEnable.dataset.accountEnable}/status`, { disabled: false });
        AceBot.toast('Account enabled');
        await AceBot.refreshSection('#accounts-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const accDisable = e.target.closest('[data-account-disable]');
    if (accDisable) {
      if (!AceBot.confirmAction('Disable this account? It will not be able to log in until re-enabled.')) return;
      try {
        await AceBot.postJSON(`/api/staff/accounts/${accDisable.dataset.accountDisable}/status`, { disabled: true });
        AceBot.toast('Account disabled');
        await AceBot.refreshSection('#accounts-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const accReset = e.target.closest('[data-account-reset]');
    if (accReset) {
      const pw = window.prompt('New password for this account (at least 8 characters):');
      if (pw === null) return;
      if (!pw || pw.length < 8) { AceBot.toast('Password must be at least 8 characters.', 'error'); return; }
      try {
        await AceBot.postJSON(`/api/staff/accounts/${accReset.dataset.accountReset}/reset-password`, { password: pw });
        AceBot.toast('Password reset');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const accDelete = e.target.closest('[data-account-delete]');
    if (accDelete) {
      if (!AceBot.confirmAction('Delete this account? This cannot be undone.')) return;
      try {
        await AceBot.del(`/api/staff/accounts/${accDelete.dataset.accountDelete}`);
        AceBot.removeRow(accDelete);
        AceBot.toast('Account deleted');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (e.target.closest('#backup-now')) {
      const out = document.getElementById('backup-result');
      if (out) out.textContent = 'Backing up…';
      try {
        const r = await AceBot.postJSON('/api/staff/backup-now', {});
        if (out) out.textContent = `✅ Saved ${r.filename} (${(r.sizeBytes / 1024).toFixed(1)} KB).`;
        AceBot.toast('Backup saved');
        await AceBot.refreshSection('#backup-files');
        await AceBot.refreshSection('#backup-logs');
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const sbRestore = e.target.closest('[data-serverbackup-restore]');
    if (sbRestore) {
      const id = sbRestore.dataset.serverbackupRestore;
      const replace = document.querySelector(`[data-serverbackup-replace="${id}"]`)?.checked || false;
      if (!AceBot.confirmAction(replace ? 'Restore this backup AND delete roles/channels not in it (replace mode)?' : 'Restore this backup? Roles/channels will be created or updated by name; nothing is deleted.')) return;
      try {
        const r = await AceBot.postJSON(`/api/staff/serverbackups/${id}/restore`, { replace });
        AceBot.toast(`Restore complete: ${r.summary.rolesCreated} roles, ${r.summary.channelsCreated} channels created`);
      } catch (err) { AceBot.toast('Restore failed: ' + err.message, 'error'); }
      return;
    }
    const sbDelete = e.target.closest('[data-serverbackup-delete]');
    if (sbDelete) {
      if (!AceBot.confirmAction('Delete this server backup?')) return;
      try {
        await AceBot.del(`/api/staff/serverbackups/${sbDelete.dataset.serverbackupDelete}`);
        AceBot.removeRow(sbDelete);
        AceBot.toast('Server backup deleted');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (e.target.closest('#presence-rotate')) {
      const out = document.getElementById('presence-rotate-result');
      if (out) out.textContent = 'Rotating…';
      try {
        await AceBot.postJSON('/api/staff/presence/rotate', {});
        if (out) out.textContent = '✅ Rotate requested — the bot picks it up on its next tick (within a minute).';
      } catch (err) { if (out) out.textContent = '❌ Failed: ' + err.message; }
      return;
    }
    if (e.target.closest('#resolve-error')) {
      const btn = e.target.closest('#resolve-error');
      try {
        const res = await fetch(btn.dataset.resolveUrl || ('/api' + window.location.pathname + '/resolve'), { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        btn.outerHTML = '<p class="muted">✅ Marked resolved.</p>';
        AceBot.toast('Error marked resolved');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    if (e.target.closest('#purge-all-errors')) {
      if (!AceBot.confirmAction('Purge ALL error logs? This deletes every row from the error_logs table, clears logs/bot-errors.log, and drops any entries the bot queued while the database was unreachable. This cannot be undone.')) return;
      try {
        const r = await AceBot.postJSON('/api/staff/errors/purge', {});
        AceBot.toast(`Purged ${r.deleted} error log${r.deleted === 1 ? '' : 's'}${r.fileCleared ? ' and cleared the log file' : ' (log file not cleared)'}${r.dbAvailable === false ? ' — database was unreachable, rows may remain' : ''}`);
        await AceBot.refreshSection('#errors-list');
        const out = document.getElementById('purge-result');
        if (out) out.textContent = `✅ Purged ${r.deleted} error log${r.deleted === 1 ? '' : 's'}${r.fileCleared ? ' and cleared the log file' : ''}.`;
      } catch (err) { AceBot.toast('Purge failed: ' + err.message, 'error'); }
      return;
    }
    if (e.target.closest('#purge-selected-errors')) {
      const ids = [...document.querySelectorAll('.error-select:checked')].map((cb) => parseInt(cb.value, 10)).filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) { AceBot.toast('Nothing selected.', 'error'); return; }
      if (!AceBot.confirmAction(`Purge ${ids.length} selected error log${ids.length === 1 ? '' : 's'}? This deletes only the checked rows from the database. The log file is not touched. This cannot be undone.`)) return;
      try {
        const r = await AceBot.postJSON('/api/staff/errors/purge', { ids });
        AceBot.toast(`Purged ${r.deleted} error log${r.deleted === 1 ? '' : 's'}`);
        await AceBot.refreshSection('#errors-list');
        const out = document.getElementById('purge-result');
        if (out) out.textContent = `✅ Purged ${r.deleted} selected error log${r.deleted === 1 ? '' : 's'} (log file untouched).`;
      } catch (err) { AceBot.toast('Purge failed: ' + err.message, 'error'); }
      return;
    }
    if (e.target.closest('#botflags-refresh')) {
      const btn = e.target.closest('#botflags-refresh');
      btn.textContent = 'Refreshing…';
      const a = await AceBot.refreshSection('#botflags-list');
      const b = await AceBot.refreshSection('#botflags-stats');
      AceBot.toast(a && b ? 'Refreshed' : 'Refresh failed — reload the page to retry', a && b ? 'success' : 'error');
      btn.textContent = '🔄 Refresh';
      return;
    }
    const clear = e.target.closest('[data-botflag-clear]');
    if (clear) {
      try {
        await AceBot.postJSON(`/api/staff/botflags/${clear.dataset.botflagClear}/clear`, {});
        AceBot.toast('Flag cleared');
        await AceBot.refreshSection('#botflags-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const kick = e.target.closest('[data-botflag-kick]');
    if (kick) {
      if (!AceBot.confirmAction(`Kick <@${kick.dataset.botflagUser}> from the server?`)) return;
      try {
        await AceBot.postJSON(`/api/staff/botflags/${kick.dataset.botflagKick}/kick`, {});
        AceBot.toast('Member kicked');
        await AceBot.refreshSection('#botflags-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
    const ban = e.target.closest('[data-botflag-ban]');
    if (ban) {
      if (!AceBot.confirmAction(`Ban <@${ban.dataset.botflagUser}> from the server? This is permanent until unbanned.`)) return;
      try {
        await AceBot.postJSON(`/api/staff/botflags/${ban.dataset.botflagBan}/ban`, {});
        AceBot.toast('Member banned');
        await AceBot.refreshSection('#botflags-list');
      } catch (err) { AceBot.toast('Failed: ' + err.message, 'error'); }
      return;
    }
  });

  // --- Broadcast live preview (updates as you type) ---
  const bTitle = document.querySelector('#broadcast-form input[name="title"]');
  const bBody = document.querySelector('#broadcast-form textarea[name="body"]');
  const bPreview = document.getElementById('broadcast-preview');
  function updateBroadcastPreview() {
    if (!bPreview) return;
    const title = bTitle ? bTitle.value : '';
    const body = bBody ? bBody.value : '';
    bPreview.style.display = title || body ? '' : 'none';
    const t = bPreview.querySelector('[data-preview-title]');
    const b = bPreview.querySelector('[data-preview-body]');
    if (t) t.textContent = title || '(no title)';
    if (b) b.textContent = body || '(no message)';
  }
  if (bTitle) bTitle.addEventListener('input', updateBroadcastPreview);
  if (bBody) bBody.addEventListener('input', updateBroadcastPreview);
  updateBroadcastPreview();

  // --- Embed Creator (1.15.26; shared since 1.15.31) ---
  // Live preview + send live in dashboard/public/js/embed-creator.js
  // (same form on the staff page and the per-server page); here it is
  // wired to the staff send route with per-guild channel loading.
  if (window.AceBotEmbedCreator) {
    window.AceBotEmbedCreator.init({
      sendUrl: '/api/staff/embed-creator',
      channelsUrl: (gid) => `/api/staff/guilds/${gid}/channels`,
    });
  }
})();
