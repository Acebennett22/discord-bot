// Verify 1.15.26: dashboard Embed Creator.
// Checks the embed builder/validator directly, the staff-gated routes in
// src/dashboard.js (source), the form + live preview in staff.ejs /
// staff.js / style.css, and that no bot command code was touched.
// Run: node tmp/verify-1.15.26.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildEmbed, LIMITS } = require('../src/utils/embedBuilder');

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}
function throwsWith(fn, fragment) {
  try { fn(); return false; }
  catch (e) { return typeof e.message === 'string' && e.message.includes(fragment); }
}

console.log('== embedBuilder: valid builds ==');
{
  const full = buildEmbed({
    content: 'Hey @everyone',
    title: 'Test title', description: 'Some **bold** text',
    color: '#5865F2', authorName: 'Kitten', authorIcon: 'https://example.com/a.png',
    footerText: 'Footer here', footerIcon: 'https://example.com/f.png',
    thumbnail: 'https://example.com/t.png', image: 'https://example.com/i.png',
    fields: [{ name: 'F1', value: 'V1', inline: true }, { name: 'F2', value: 'V2', inline: false }],
  });
  check('full build returns content + embed', full.content === 'Hey @everyone' && full.embed.title === 'Test title');
  check('color hex parsed to int', full.embed.color === 0x5865f2);
  check('author/footer/thumbnail/image kept', full.embed.author?.name === 'Kitten' && full.embed.author?.icon_url === 'https://example.com/a.png'
    && full.embed.footer?.text === 'Footer here' && full.embed.thumbnail?.url === 'https://example.com/t.png' && full.embed.image?.url === 'https://example.com/i.png');
  check('fields kept with inline flags', full.embed.fields?.length === 2 && full.embed.fields[0].inline === true && full.embed.fields[1].inline === false);
  const minimal = buildEmbed({ title: 'Only a title' });
  check('title-only build ok, no content key', minimal.embed.title === 'Only a title' && minimal.content === undefined);
  const contentOnly = buildEmbed({ content: 'just text' });
  check('content-only build ok', contentOnly.content === 'just text' && Object.keys(contentOnly.embed).length === 1);
  const blankField = buildEmbed({ title: 'T', fields: [{ name: '', value: '' }, { name: 'Real', value: 'Yes' }] });
  check('blank field rows ignored', blankField.embed.fields?.length === 1);
  const noColor = buildEmbed({ title: 'T' });
  check('missing color defaults to blurple', noColor.embed.color === 0x5865f2);
}

console.log('== embedBuilder: limit rejections ==');
check('title 257 rejected', throwsWith(() => buildEmbed({ title: 'x'.repeat(257) }), 'at most 256'));
check('description 4097 rejected', throwsWith(() => buildEmbed({ description: 'x'.repeat(4097) }), 'at most 4096'));
check('content 2001 rejected', throwsWith(() => buildEmbed({ content: 'x'.repeat(2001) }), 'at most 2000'));
check('field name 257 rejected', throwsWith(() => buildEmbed({ title: 'T', fields: [{ name: 'x'.repeat(257), value: 'v' }] }), 'at most 256'));
check('field value 1025 rejected', throwsWith(() => buildEmbed({ title: 'T', fields: [{ name: 'n', value: 'x'.repeat(1025) }] }), 'at most 1024'));
check('26 fields rejected', throwsWith(() => buildEmbed({ title: 'T', fields: Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: 'v' })) }), 'at most 25'));
check('total >6000 rejected', throwsWith(() => buildEmbed({ title: 'x'.repeat(256), description: 'x'.repeat(4096), fields: [{ name: 'x'.repeat(256), value: 'x'.repeat(1024) }, { name: 'x'.repeat(256), value: 'x'.repeat(1024) }] }), 'at most 6000'));
check('bad thumbnail URL rejected', throwsWith(() => buildEmbed({ title: 'T', thumbnail: 'not-a-url' }), 'must be a full http(s) URL'));
check('bad author icon URL rejected', throwsWith(() => buildEmbed({ title: 'T', authorName: 'A', authorIcon: 'ftp://example.com/a.png' }), 'must be a full http(s) URL'));
check('bad color rejected', throwsWith(() => buildEmbed({ title: 'T', color: 'banana' }), 'hex color'));
check('empty embed rejected', throwsWith(() => buildEmbed({}), 'Nothing to send'));
check('field without value rejected', throwsWith(() => buildEmbed({ title: 'T', fields: [{ name: 'n', value: '' }] }), 'needs a value'));
check('limits exported match Discord', LIMITS.title === 256 && LIMITS.description === 4096 && LIMITS.fields === 25 && LIMITS.total === 6000 && LIMITS.content === 2000);

console.log('== dashboard routes (source) ==');
const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
check('page route GET /staff/embed-creator exists', dash.includes("app.get('/staff/embed-creator'"));
check('page route is requireStaff-gated', /app\.get\('\/staff\/embed-creator', requireStaff/.test(dash));
check('channels route GET /api/staff/guilds/:id/channels exists', dash.includes("app.get('/api/staff/guilds/:id/channels'"));
check('channels route is requireStaff-gated', /app\.get\('\/api\/staff\/guilds\/:id\/channels', requireStaff/.test(dash));
check('send route POST /api/staff/embed-creator exists', dash.includes("app.post('/api/staff/embed-creator'"));
check('send route is requireStaff-gated', /app\.post\('\/api\/staff\/embed-creator', requireStaff/.test(dash));
check('send route validates via buildEmbed', dash.includes("require('./utils/embedBuilder').buildEmbed"));
check('send route verifies channel is a text channel in the guild', dash.includes('c.id === channelId && c.type === 0'));
check('send route posts via discordApi + botHeaders (no new client)', dash.includes("discordApi.post(`/channels/${channelId}/messages`") && !/embed-creator[\s\S]{0,800}new Client/.test(dash));
check('send route audits to staff audit log', dash.includes("staffUtils.audit(req.session.user.id, 'embed.send'"));
check('send route returns Discord errors clearly', dash.includes('Discord refused the send'));
check('channels route filters to type 0 only', /filter\(\(c\) => c\.type === 0\)/.test(dash));

console.log('== staff.ejs form + preview ==');
const staffEjs = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'views', 'staff.ejs'), 'utf8');
check('nav link to Embed Creator', staffEjs.includes('href="/staff/embed-creator"'));
for (const field of ['name="guildId"', 'name="channelId"', 'name="content"', 'name="title"', 'name="description"', 'name="color"', 'name="colorHex"', 'name="authorName"', 'name="authorIcon"', 'name="footerText"', 'name="footerIcon"', 'name="thumbnail"', 'name="image"']) {
  check(`form has ${field}`, staffEjs.includes(field));
}
check('fields container + add-field button', staffEjs.includes('id="embed-fields"') && staffEjs.includes('id="embed-add-field"'));
check('live preview panel uses .discord-preview', staffEjs.includes('id="embed-preview" class="discord-preview"'));
check('send + clear buttons present', staffEjs.includes('Send embed') && staffEjs.includes('id="embed-clear"'));
check('broadcast section untouched', staffEjs.includes("section === 'broadcast'") && staffEjs.includes('id="broadcast-form"'));

console.log('== staff.js client logic ==');
const staffJs = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'js', 'staff.js'), 'utf8');
check('live preview renderer exists', staffJs.includes('function updateEmbedPreview'));
check('preview note says nothing has been sent', staffJs.includes('nothing has been sent to Discord'));
check('preview renders author/thumbnail/image/footer', staffJs.includes('dp-author') && staffJs.includes('dp-thumb') && staffJs.includes('dp-footer') && staffJs.includes('dp-image'));
check('preview uses esc + markdown pass', staffJs.includes('const esc = AceBot.esc') || staffJs.includes('AceBot.esc'));
check('field rows capped at 10', staffJs.includes('MAX_FIELDS = 10'));
check('channel loader hits staff channels API', staffJs.includes("AceBot.getJSON(`/api/staff/guilds/${guildId}/channels`)"));
check('submit posts to /api/staff/embed-creator', staffJs.includes("AceBot.postJSON('/api/staff/embed-creator'"));
check('success resets form but keeps guild/channel', staffJs.includes('keep server + channel') || staffJs.includes('keep guild/channel'));
check('no direct Discord API calls from the browser', !staffJs.includes('discord.com/api'));

console.log('== style.css preview additions ==');
const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'style.css'), 'utf8');
check('.dp-author rule', css.includes('.discord-preview .dp-author'));
check('.dp-thumb rule', css.includes('.discord-preview .dp-thumb'));
check('.dp-embed-body rule', css.includes('.discord-preview .dp-embed-body'));
check('.embed-creator-wrap layout', css.includes('.embed-creator-wrap'));
check('Streams preview base rules untouched', css.includes('.discord-preview .dp-fields') && css.includes('.discord-preview .dp-image'));

console.log('== scope: no bot command code touched ==');
const changed = execSync('git status --porcelain', { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  .split('\n').map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
const allowed = new Set([
  'src/utils/embedBuilder.js', 'src/dashboard.js', 'dashboard/views/staff.ejs',
  'dashboard/public/style.css', 'dashboard/public/js/staff.js',
  'package.json', 'CHANGELOG.md', 'tmp/verify-1.15.26.js',
]);
const unexpected = changed.filter((f) => !allowed.has(f));
check('only expected files changed', unexpected.length === 0, unexpected.join(', ') || changed.join(', '));
check('no src/commands or src/events files changed', !changed.some((f) => f.startsWith('src/commands/') || f.startsWith('src/events/')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
