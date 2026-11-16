// Shared Embed Creator client logic (1.15.31) — live Discord-style
// preview + send. Used by the staff page (dashboard/views/staff.ejs,
// init'd from dashboard/public/js/staff.js) and by the per-server page
// (dashboard/views/settings.ejs, module 'embed-creator', init'd from
// dashboard/public/js/settings.js). The form markup lives in
// dashboard/views/partials/embed-creator-form.ejs and is identical on
// both pages; only the send URL and the channel loading differ:
//   - staff page: the user picks a server first, channels are fetched
//     per guild via options.channelsUrl(guildId);
//   - per-server page: the guild is fixed (options.guildId) and the
//     channel select is server-rendered, so no channel fetching.
// The preview is built purely from the form — it sends nothing to
// Discord. Rendering mirrors the Streams preview in settings.js
// (same .discord-preview classes, same esc + **bold**/[link](url) pass).
window.AceBotEmbedCreator = (function () {
  'use strict';

  function init(options) {
    const sendUrl = options.sendUrl;
    const fixedGuildId = options.guildId || null;
    const channelsUrl = options.channelsUrl || null;
    const eForm = document.getElementById('embed-form');
    if (!eForm || !sendUrl) return;
    const eGuild = document.getElementById('embed-guild');
    const eChannel = document.getElementById('embed-channel');
    const ePreview = document.getElementById('embed-preview');
    const eFields = document.getElementById('embed-fields');
    const eAddField = document.getElementById('embed-add-field');
    const eResult = document.getElementById('embed-result');
    const eColor = eForm.querySelector('input[type="color"][name="color"]');
    const eColorHex = eForm.querySelector('input[name="colorHex"]');
    const MAX_FIELDS = 10;

    function fieldValues() {
      const out = [];
      eFields.querySelectorAll('.embed-field').forEach((row) => {
        out.push({
          name: row.querySelector('[data-f-name]').value,
          value: row.querySelector('[data-f-value]').value,
          inline: row.querySelector('[data-f-inline]').checked,
        });
      });
      return out;
    }

    function addFieldRow(name, value, inline) {
      if (eFields.querySelectorAll('.embed-field').length >= MAX_FIELDS) {
        AceBot.toast(`At most ${MAX_FIELDS} fields`, 'error');
        return;
      }
      const row = document.createElement('div');
      row.className = 'embed-field card card-block';
      row.style.margin = '0 0 8px';
      row.innerHTML = `<input type="text" data-f-name maxlength="256" placeholder="Field name" value="">`
        + `<textarea data-f-value rows="2" maxlength="1024" placeholder="Field value"></textarea>`
        + `<label class="toggle" style="margin:6px 0"><input type="checkbox" data-f-inline><span class="track"></span><span>Inline</span></label>`
        + `<button class="btn ghost" type="button" data-remove-field>Remove field</button>`;
      row.querySelector('[data-f-name]').value = name || '';
      row.querySelector('[data-f-value]').value = value || '';
      row.querySelector('[data-f-inline]').checked = Boolean(inline);
      eFields.appendChild(row);
      updateEmbedPreview();
    }

    function updateEmbedPreview() {
      if (!ePreview) return;
      const fd = new FormData(eForm);
      const esc = AceBot.esc;
      const md = (s) => esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      const content = (fd.get('content') || '').toString();
      const title = (fd.get('title') || '').toString();
      const description = (fd.get('description') || '').toString();
      const authorName = (fd.get('authorName') || '').toString();
      const authorIcon = (fd.get('authorIcon') || '').toString();
      const footerText = (fd.get('footerText') || '').toString();
      const footerIcon = (fd.get('footerIcon') || '').toString();
      const thumbnail = (fd.get('thumbnail') || '').toString();
      const image = (fd.get('image') || '').toString();
      const color = '#' + (eColor.value || '#5865F2').replace('#', '');
      const fields = fieldValues().filter((f) => f.name || f.value);
      const hasAnything = content || title || description || authorName || footerText || fields.length;
      if (!hasAnything) { ePreview.style.display = 'none'; ePreview.innerHTML = ''; return; }
      const fieldHtml = fields.map((f) => `<div class="dp-field${f.inline ? ' inline' : ''}"><div class="dp-field-name">${esc(f.name)}</div><div class="dp-field-value">${md(f.value)}</div></div>`).join('');
      const main = (authorName ? `<div class="dp-author">${authorIcon ? `<img src="${esc(authorIcon)}" alt="">` : ''}<span>${esc(authorName)}</span></div>` : '')
        + (title ? `<div class="dp-title">${esc(title)}</div>` : '')
        + (description ? `<div class="dp-desc">${md(description)}</div>` : '')
        + (fieldHtml ? `<div class="dp-fields">${fieldHtml}</div>` : '')
        + (image ? `<img class="dp-image" src="${esc(image)}" alt="Embed image">` : '')
        + (footerText ? `<div class="dp-footer">${footerIcon ? `<img src="${esc(footerIcon)}" alt="">` : ''}${esc(footerText)}</div>` : '');
      ePreview.innerHTML = `<div class="dp-note"><span>🔍 Live preview — nothing has been sent to Discord.</span></div>`
        + (content ? `<div class="dp-content">${md(content)}</div>` : '')
        + `<div class="dp-embed" style="border-left-color:${color}"><div class="dp-embed-body"><div class="dp-embed-main">${main}</div>`
        + (thumbnail ? `<img class="dp-thumb" src="${esc(thumbnail)}" alt="Thumbnail">` : '')
        + '</div></div>';
      ePreview.style.display = '';
    }

    async function loadChannels() {
      const guildId = eGuild.value;
      eChannel.innerHTML = '<option value="">— Loading… —</option>';
      eChannel.disabled = true;
      if (!guildId) {
        eChannel.innerHTML = '<option value="">— Pick a server first —</option>';
        return;
      }
      try {
        const data = await AceBot.getJSON(channelsUrl(guildId));
        const chans = data.channels || [];
        eChannel.innerHTML = chans.length
          ? '<option value="">— Pick a channel —</option>' + chans.map((c) => `<option value="${c.id}">#${AceBot.esc(c.name)}</option>`).join('')
          : '<option value="">— No text channels —</option>';
        eChannel.disabled = !chans.length;
      } catch (err) {
        eChannel.innerHTML = '<option value="">— Could not load channels —</option>';
        AceBot.toast('Failed to load channels: ' + err.message, 'error');
      }
    }

    // Staff page only: the channel picker follows the server picker.
    // The per-server page has a fixed guild and server-rendered channels.
    if (eGuild && channelsUrl) eGuild.addEventListener('change', loadChannels);
    eForm.addEventListener('input', updateEmbedPreview);
    if (eColor && eColorHex) {
      eColor.addEventListener('input', () => { eColorHex.value = eColor.value.toUpperCase(); updateEmbedPreview(); });
      eColorHex.addEventListener('input', () => {
        if (/^#?[0-9a-fA-F]{6}$/.test(eColorHex.value)) eColor.value = eColorHex.value.startsWith('#') ? eColorHex.value : '#' + eColorHex.value;
        updateEmbedPreview();
      });
    }
    if (eAddField) eAddField.addEventListener('click', () => addFieldRow());
    eFields.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove-field]')) {
        e.target.closest('.embed-field').remove();
        updateEmbedPreview();
      }
    });
    document.getElementById('embed-clear').addEventListener('click', () => {
      const guildId = eGuild ? eGuild.value : null;
      const channelId = eChannel.value;
      eForm.reset();
      eFields.innerHTML = '';
      addFieldRow();
      if (eGuild) eGuild.value = guildId;
      eChannel.value = channelId;
      if (eResult) eResult.textContent = '';
      updateEmbedPreview();
    });
    eForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(eForm);
      const btn = eForm.querySelector('button[type="submit"]');
      if (eResult) eResult.textContent = 'Sending…';
      if (btn) btn.disabled = true;
      try {
        const r = await AceBot.postJSON(sendUrl, {
          guildId: eGuild ? fd.get('guildId') : fixedGuildId, channelId: fd.get('channelId'),
          content: fd.get('content'), title: fd.get('title'), description: fd.get('description'),
          color: fd.get('color'), authorName: fd.get('authorName'), authorIcon: fd.get('authorIcon'),
          footerText: fd.get('footerText'), footerIcon: fd.get('footerIcon'),
          thumbnail: fd.get('thumbnail'), image: fd.get('image'), fields: fieldValues(),
        });
        if (eResult) eResult.textContent = `✅ Sent to #${r.channelName}.`;
        AceBot.toast(`Embed sent to #${r.channelName}`);
        // Sensible reset: clear the composed embed, keep server + channel
        // so another embed can go to the same place right away.
        const guildId = eGuild ? eGuild.value : null;
        const channelId = eChannel.value;
        eForm.reset();
        eFields.innerHTML = '';
        addFieldRow();
        if (eGuild) eGuild.value = guildId;
        eChannel.value = channelId;
        updateEmbedPreview();
      } catch (err) {
        if (eResult) eResult.textContent = '❌ Failed: ' + err.message;
        AceBot.toast('Failed: ' + err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // One empty field row to start with, and a first preview render.
    addFieldRow();
    updateEmbedPreview();
  }

  return { init };
})();
