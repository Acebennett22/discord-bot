// Clean HTML transcript generator (no extra dependency).
// Fetches up to 1000 recent messages from a channel and writes an HTML file
// to transcripts/<guildId>-<channelId>-<timestamp>.html
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchAllMessages(channel) {
  const all = [];
  let before = null;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    const arr = [...batch.values()];
    all.push(...arr);
    before = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

async function generateTranscript(channel, ticket) {
  const messages = await fetchAllMessages(channel);
  const dir = path.join(__dirname, '..', '..', 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${channel.guildId}-${channel.id}-${Date.now()}.html`;
  const filePath = path.join(dir, filename);

  const rows = messages.map((m) => {
    const attachments = [...m.attachments.values()].map((a) => {
      const isImage = a.contentType?.startsWith('image/');
      return isImage
        ? `<div><a href="${esc(a.url)}" target="_blank"><img src="${esc(a.url)}" style="max-width:400px;border-radius:8px"></a></div>`
        : `<div>📎 <a href="${esc(a.url)}" target="_blank">${esc(a.name || a.url)}</a></div>`;
    }).join('');
    const embeds = m.embeds.length ? `<div class="embed">${esc(m.embeds.map((e) => e.title || e.description || '').filter(Boolean).join(' — '))}</div>` : '';
    return `<div class="msg">
      <img class="avatar" src="${esc(m.author.displayAvatarURL({ size: 64 }))}" alt="">
      <div class="body">
        <div class="head"><span class="author" style="color:${m.member?.displayHexColor || '#fff'}">${esc(m.author.tag)}</span>
        <span class="time">${esc(new Date(m.createdTimestamp).toLocaleString())}</span></div>
        <div class="content">${esc(m.content) || '<i>(no text)</i>'}</div>
        ${attachments}${embeds}
      </div>
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Ticket transcript — #${esc(channel.name)}</title>
<style>
body{background:#1e1f22;color:#dbdee1;font-family:Arial,sans-serif;margin:0;padding:20px}
h1{font-size:20px} .sub{color:#949ba4;font-size:13px;margin-bottom:20px}
.msg{display:flex;gap:12px;margin-bottom:16px}
.avatar{width:40px;height:40px;border-radius:50%}
.author{font-weight:bold} .time{color:#949ba4;font-size:12px;margin-left:8px}
.content{white-space:pre-wrap;word-break:break-word}
.embed{border-left:3px solid #5865f2;background:#2b2d31;padding:8px;border-radius:4px;margin-top:6px;color:#b5bac1}
</style></head><body>
<h1>📄 Ticket transcript — #${esc(channel.name)}</h1>
<div class="sub">Server: ${esc(channel.guild.name)} · Subject: ${esc(ticket?.subject || '—')} · Opened by: ${esc(ticket?.userId || '—')} · Messages: ${messages.length} · Generated: ${esc(new Date().toLocaleString())}</div>
${rows || '<p>No messages in this ticket.</p>'}
</body></html>`;

  fs.writeFileSync(filePath, html);
  return { filePath, filename, messageCount: messages.length };
}

module.exports = { generateTranscript };
