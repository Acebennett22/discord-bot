// Verify 1.15.31: Embed Creator for regular dashboard users.
// Checks: user route gating + behavior parity with the staff version,
// shared form/JS reuse, staff route intact, and the 1.15.26 wire-shape
// bug fix (buildEmbed must return { content, embeds: [embed] } —
// Discord silently drops a singular `embed` key).
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const dash = read('src/dashboard.js');
const staffEjs = read('dashboard/views/staff.ejs');
const settingsEjs = read('dashboard/views/settings.ejs');
const partial = read('dashboard/views/partials/embed-creator-form.ejs');
const sharedJs = read('dashboard/public/js/embed-creator.js');
const staffJs = read('dashboard/public/js/staff.js');
const settingsJs = read('dashboard/public/js/settings.js');
const { buildEmbed } = require('../src/utils/embedBuilder');

console.log('== user route: gating ==');
check('user route POST /api/guilds/:id/embed-creator exists',
  dash.includes("app.post('/api/guilds/:id/embed-creator', requireAuth, requireGuildAccess,"));
check('user route is NOT requireStaff-gated',
  !/app\.post\('\/api\/guilds\/:id\/embed-creator', requireStaff/.test(dash)
  && !/app\.post\('\/api\/guilds\/:id\/embed-creator'[^;]{0,200}requireStaff/.test(dash));
check('user route takes guild from URL (:id), not the body',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,400}const guildId = req\.params\.id;/.test(dash));
check('user route uses requireGuildAccess (Manage Server gate)',
  dash.includes("async function requireGuildAccess")
  && /requireGuildAccess[\s\S]{0,600}canManage\(guild\)/.test(dash)
  && /function canManage\(guild\) \{\s*\/\/ Manage Guild permission bit \(0x20\)/.test(dash));

console.log('== user route: same send path as staff ==');
check('user route validates via shared buildEmbed()',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,900}require\('\.\/utils\/embedBuilder'\)\.buildEmbed\(req\.body/.test(dash));
check('user route re-verifies channel is a real text channel in the guild',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,1400}channels\.find\(\(c\) => c\.id === channelId && c\.type === 0\)/.test(dash));
check('user route posts via discordApi + botHeaders (no new client)',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,1800}discordApi\.post\(`\/channels\/\$\{channelId\}\/messages`, payload/.test(dash));
check('user route audits the send with the sending user id',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,1800}staffUtils\.audit\(req\.session\.user\.id, 'embed\.send'/.test(dash));
check('user route returns channelName + messageId on success',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,1800}res\.json\(\{ ok: true, messageId: msg\.data\.id, channelId, channelName: channel\.name \}\)/.test(dash));
check('user route maps Discord 403 to 403, other failures to 400',
  /app\.post\('\/api\/guilds\/:id\/embed-creator'[\s\S]{0,2000}e\.response\?\.status === 403 \? 403 : 400/.test(dash));

console.log('== staff route intact ==');
check('staff page route still requireStaff',
  dash.includes("app.get('/staff/embed-creator', requireStaff,"));
check('staff send route still requireStaff',
  dash.includes("app.post('/api/staff/embed-creator', requireStaff,"));
check('staff send route still posts the builder payload as-is',
  /app\.post\('\/api\/staff\/embed-creator'[\s\S]{0,1400}discordApi\.post\(`\/channels\/\$\{channelId\}\/messages`, payload/.test(dash));
check('staff audit line follows the fixed builder shape (embeds[0].title)',
  dash.includes('payload.embeds[0].title'));
check('no remaining payload.embed. reference in dashboard.js',
  !dash.includes('payload.embed.'));

console.log('== buildEmbed wire-shape fix (1.15.26 bug) ==');
const full = buildEmbed({
  content: 'hello', title: 'T', description: 'D', color: '#ff0000',
  authorName: 'A', footerText: 'F', thumbnail: 'https://x.test/t.png', image: 'https://x.test/i.png',
  fields: [{ name: 'f1', value: 'v1', inline: true }],
});
check('buildEmbed returns embeds array (not singular embed)',
  Array.isArray(full.embeds) && full.embeds.length === 1 && !('embed' in full));
check('buildEmbed embeds[0] carries title/description/color/author/footer/thumbnail/image/fields',
  full.embeds[0].title === 'T' && full.embeds[0].description === 'D' && full.embeds[0].color === 0xff0000
  && full.embeds[0].author.name === 'A' && full.embeds[0].footer.text === 'F'
  && full.embeds[0].thumbnail.url === 'https://x.test/t.png' && full.embeds[0].image.url === 'https://x.test/i.png'
  && full.embeds[0].fields.length === 1 && full.embeds[0].fields[0].inline === true);
check('buildEmbed content-only build has no empty embeds array issue (embeds[0] is a valid embed object)',
  (() => { const b = buildEmbed({ content: 'just text' }); return Array.isArray(b.embeds) && typeof b.embeds[0].color === 'number' && b.content === 'just text'; })());
check('buildEmbed still rejects over-limit title (validation unchanged)',
  (() => { try { buildEmbed({ title: 'x'.repeat(257) }); return false; } catch (e) { return /at most 256/.test(e.message); } })());
check('buildEmbed still rejects over-limit description',
  (() => { try { buildEmbed({ description: 'x'.repeat(4097) }); return false; } catch (e) { return /at most 4096/.test(e.message); } })());
check('buildEmbed still rejects empty embed',
  (() => { try { buildEmbed({}); return false; } catch (e) { return /Nothing to send/.test(e.message); } })());
check('buildEmbed still rejects bad image URL',
  (() => { try { buildEmbed({ title: 'T', image: 'ftp://x.test/i.png' }); return false; } catch (e) { return /http\(s\)/.test(e.message); } })());

console.log('== module wiring ==');
check("MODULES includes 'embed-creator'",
  /const MODULES = \[[^\]]*'embed-creator'/.test(dash));
check('settings.ejs nav includes Embed Creator link',
  settingsEjs.includes("['embed-creator','📝 Embed Creator']"));
check('settings.ejs has an embed-creator module section including the partial',
  settingsEjs.includes("if (module === 'embed-creator')") && settingsEjs.includes("include('partials/embed-creator-form', { showGuildPicker: false })"));
check('staff.ejs includes the shared partial (guild picker on)',
  staffEjs.includes("include('partials/embed-creator-form', { showGuildPicker: true, guilds: data.guilds })"));
check('staff.ejs no longer has the inline form markup (no duplicate form)',
  !staffEjs.includes('<form id="embed-form">'));
check('settings.ejs loads embed-creator.js before settings.js',
  settingsEjs.indexOf('/js/embed-creator.js') !== -1
  && settingsEjs.indexOf('/js/embed-creator.js') < settingsEjs.indexOf('/js/settings.js'));
check('staff.ejs loads embed-creator.js before staff.js',
  staffEjs.indexOf('/js/embed-creator.js') !== -1
  && staffEjs.indexOf('/js/embed-creator.js') < staffEjs.indexOf('/js/staff.js'));

console.log('== shared partial renders ==');
(async () => {
  const userHtml = await ejs.renderFile(path.join(root, 'dashboard/views/partials/embed-creator-form.ejs'),
    { showGuildPicker: false, channels: [
      { id: '111111111111111111', name: 'general', type: 0, position: 1 },
      { id: '222222222222222222', name: 'voice-lounge', type: 2, position: 0 },
      { id: '333333333333333333', name: 'announcements', type: 0, position: 0 },
    ] }, { async: true });
  check('user render: no server picker, channel select lists text channels only, sorted by position',
    !userHtml.includes('id="embed-guild"')
    && userHtml.includes('<option value="333333333333333333">#announcements</option>')
    && userHtml.includes('<option value="111111111111111111">#general</option>')
    && !userHtml.includes('voice-lounge'));
  check('user render: all 15 form fields + preview present',
    ['name="content"', 'name="title"', 'name="description"', 'name="color"', 'name="colorHex"',
     'name="authorName"', 'name="authorIcon"', 'name="footerText"', 'name="footerIcon"',
     'name="thumbnail"', 'name="image"', 'id="embed-fields"', 'id="embed-add-field"',
     'id="embed-clear"', 'id="embed-preview"'].every((s) => userHtml.includes(s)));
  const staffHtml = await ejs.renderFile(path.join(root, 'dashboard/views/partials/embed-creator-form.ejs'),
    { showGuildPicker: true, guilds: [{ id: '999999999999999999', name: 'Test Hall' }] }, { async: true });
  check('staff render: server picker present, channel select disabled until a server is picked',
    staffHtml.includes('id="embed-guild"') && staffHtml.includes('<option value="999999999999999999">Test Hall</option>')
    && staffHtml.includes('id="embed-channel" required disabled'));
  check('staff render: same form fields as user render (one shared form)',
    ['name="content"', 'name="title"', 'name="description"', 'name="authorName"', 'id="embed-fields"', 'id="embed-preview"']
      .every((s) => staffHtml.includes(s)));

  console.log('== shared client JS ==');
  check('embed-creator.js exposes AceBotEmbedCreator.init',
    sharedJs.includes('window.AceBotEmbedCreator') && sharedJs.includes('function init(options)') && sharedJs.includes('return { init };'));
  check('shared JS sends to options.sendUrl (no hardcoded staff URL)',
    sharedJs.includes('AceBot.postJSON(sendUrl,') && !sharedJs.includes('/api/staff/embed-creator'));
  check('shared JS makes no direct Discord calls from the browser',
    !/discord\.com\/api/.test(sharedJs));
  check('shared JS caps fields at 10 and renders live preview',
    sharedJs.includes('MAX_FIELDS = 10') && sharedJs.includes('function updateEmbedPreview()'));
  check('shared JS guards the guild picker (staff-only path) so the fixed-guild page works',
    sharedJs.includes('if (eGuild && channelsUrl)') && sharedJs.includes('eGuild ? fd.get(\'guildId\') : fixedGuildId'));
  check('staff.js inits shared creator with staff send URL + channel loader',
    staffJs.includes("window.AceBotEmbedCreator.init({")
    && staffJs.includes("sendUrl: '/api/staff/embed-creator'")
    && staffJs.includes("channelsUrl: (gid) => `/api/staff/guilds/${gid}/channels`"));
  check('staff.js no longer contains the inline embed block (no duplicate logic)',
    !staffJs.includes('function updateEmbedPreview()') && !staffJs.includes("document.getElementById('embed-form')"));
  check("settings.js inits shared creator with per-guild send URL + guildId",
    settingsJs.includes("window.AceBotEmbedCreator.init({ sendUrl: api('/embed-creator'), guildId })"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('VERIFY CRASH:', e); process.exit(1); });
