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
  });

  // --- Click handlers (delegated) ---
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
})();
