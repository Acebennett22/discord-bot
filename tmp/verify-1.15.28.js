// Verify 1.15.28: ticket panel repost (dashboard).
// Loads a temp copy of src/dashboard.js with the listen IIFE replaced by an
// export, with stubbed database + axios modules, then invokes the REAL
// repost route handler with mocked req/res. Run from the repo root:
//   ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.28.js
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const repo = path.resolve(__dirname, '..');
process.chdir(repo);
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

const dashSrc = fs.readFileSync(path.join(repo, 'src/dashboard.js'), 'utf8');
const ejsSrc = fs.readFileSync(path.join(repo, 'dashboard/views/settings.ejs'), 'utf8');
const settingsJs = fs.readFileSync(path.join(repo, 'dashboard/public/js/settings.js'), 'utf8');

// --- Stub database + axios BEFORE anything requires them ---
const dbPath = path.join(repo, 'src/utils/database.js');
const axiosPath = require.resolve('axios', { paths: [repo] });
const queries = [];
let panelRow = {
  id: 7, guild_id: 'g1', channel_id: 'chan-1', category_id: null,
  staff_role_id: null, title: 'Support', description: null,
  message_id: 'old-msg-99', created_by: 'u1',
};
const fakeDb = {
  isEnabled: () => true,
  initDatabase: async () => {},
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM ticket_panels') && sql.includes('WHERE guild_id')) return panelRow ? [panelRow] : [];
    if (sql.includes('FROM guild_settings')) return [{ ticket_button_label: 'Send a Raven' }];
    if (sql.startsWith('UPDATE ticket_panels SET message_id')) return {};
    if (sql.startsWith('INSERT INTO staff_audit')) return {};
    return [];
  },
};
const apiCalls = { posts: [], deletes: [] };
let failPost = false;
const fakeAxios = {
  create: () => ({
    get: async () => ({ data: [] }),
    post: async (url, body) => {
      apiCalls.posts.push({ url, body });
      if (failPost) throw new Error('403 Forbidden');
      return { data: { id: 'new-msg-123' } };
    },
    delete: async (url) => { apiCalls.deletes.push(url); return {}; },
  }),
};
function seedCache(resolved, exportsObj) {
  const m = new Module(resolved, null);
  m.filename = resolved; m.loaded = true; m.exports = exportsObj;
  require.cache[resolved] = m;
}
seedCache(dbPath, fakeDb);
seedCache(axiosPath, fakeAxios);

console.log('== source checks ==');
// 1. Repost route exists, gated by requireAuth + requireGuildAccess.
check('repost route exists and is auth-gated',
  /app\.post\('\/api\/guilds\/:id\/ticket-panels\/:panelId\/repost', requireAuth, requireGuildAccess/.test(dashSrc));
// 2. Old message deleted via discordApi.delete with the stored message id.
check('route deletes the old panel message',
  dashSrc.includes("discordApi.delete(`/channels/${panel.channel_id}/messages/${panel.message_id}`"));
// 3. Fresh panel posted through the shared builders (no inline payload).
check('route posts via ticketPanelEmbed + ticketPanelRow',
  dashSrc.includes('ticketPanelEmbed(panel.title, panel.description, label).toJSON()')
  && dashSrc.includes('ticketPanelRow(panel.id, label).toJSON()'));
// 4. Stored message_id updated to the new message.
check('route updates stored message_id',
  dashSrc.includes("UPDATE ticket_panels SET message_id = ? WHERE id = ?"));
// 5. Repost logged to the staff audit log.
check('route audits ticket.repost',
  dashSrc.includes("staffUtils.audit(req.session.user.id, 'ticket.repost'"));
// 6. Create route now uses the same shared builders (no inline embed).
{
  const createStart = dashSrc.indexOf("app.post('/api/guilds/:id/ticket-panels'");
  const createEnd = dashSrc.indexOf('app.delete', createStart);
  const createBody = dashSrc.slice(createStart, createEnd);
  check('create route uses shared panel builders',
    createBody.includes('ticketPanelEmbed(title, description, buttonLabel).toJSON()')
    && createBody.includes('ticketPanelRow(panel.id, buttonLabel).toJSON()')
    && !createBody.includes('embeds: [{ title:'));
}
// 7/8. EJS: Repost button per panel row + hint points at it.
check('EJS has a Repost button per panel',
  /data-repost-panel="\/api\/guilds\/<%= guild\.id %>\/ticket-panels\/<%= p\.id %>\/repost"/.test(ejsSrc));
check('EJS hint mentions the Repost button',
  ejsSrc.includes('use the Repost button on an existing panel below to refresh it with the new label'));
// 9. Frontend handler: confirm + POST + refresh.
check('settings.js repost handler (confirm, post, refresh)',
  settingsJs.includes("e.target.closest('[data-repost-panel]')")
  && settingsJs.includes('AceBot.confirmAction(')
  && settingsJs.includes('AceBot.postJSON(repostBtn.dataset.repostPanel)')
  && settingsJs.includes("AceBot.refreshSection('#ticket-panels-list')"));
// 10. No report-button remnants from the discarded task.
check('no report-button code in touched files',
  !/ticket_report|Report button label|report_button/.test(dashSrc + ejsSrc + settingsJs)
  && !/ticket_report/.test(fs.readFileSync(path.join(repo, 'src/utils/tickets.js'), 'utf8')));

console.log('== builder checks (real tickets.js) ==');
const tickets = require(path.join(repo, 'src/utils/tickets.js'));
{
  const row = tickets.ticketPanelRow(7, 'Send a Raven').toJSON();
  const btn = row.components[0];
  check('panel row button uses the custom label', btn.label === 'Send a Raven');
  check('panel row button customId unchanged', btn.custom_id === 'ticket_create:7');
  check('panel row has exactly one (ticket) button', row.components.length === 1);
  const defRow = tickets.ticketPanelRow(7, '').toJSON();
  check('ticket button defaults to Create Ticket when label blank', defRow.components[0].label === 'Create Ticket');
  const emb = tickets.ticketPanelEmbed('Support', null, 'Send a Raven').toJSON();
  check('panel embed description mentions the custom label',
    emb.description.includes('Send a Raven') && !emb.description.includes('Create Ticket'));
  check('resolveTicketButtonLabel custom/default',
    tickets.resolveTicketButtonLabel({ ticketButtonLabel: 'Send a Raven' }) === 'Send a Raven'
    && tickets.resolveTicketButtonLabel({}) === 'Create Ticket');
}

console.log('== live handler checks (real route, stubbed db + axios) ==');
// --- Temp dashboard copy: swap the listen IIFE for an export ---
const tmpDash = path.join(repo, 'src/dashboard.verify-tmp.js');
const startIdx = dashSrc.indexOf('// --- Start ---');
if (startIdx === -1) { console.log('  FAIL could not find Start block in dashboard.js'); process.exit(1); }
fs.writeFileSync(tmpDash, dashSrc.slice(0, startIdx) + 'module.exports = app;\n');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

(async () => {
  try {
    const app = require(tmpDash);
    const layers = app._router.stack.filter((l) => l.route && l.route.path === '/api/guilds/:id/ticket-panels/:panelId/repost');
    check('repost route registered (POST)', layers.length === 1 && layers[0].route.methods.post === true);
    const stack = layers[0].route.stack;
    check('route stack is auth + access + handler', stack.length === 3);
    const handler = stack[stack.length - 1].handle;

    // Success flow.
    queries.length = 0; apiCalls.posts.length = 0; apiCalls.deletes.length = 0;
    const res = fakeRes();
    await handler({ params: { id: 'g1', panelId: '7' }, session: { user: { id: 'u-staff' } } }, res);
    check('success: 200 ok + new message id', res.statusCode === 200 && res.body && res.body.ok === true && res.body.messageId === 'new-msg-123');
    check('success: old message deleted',
      apiCalls.deletes.length === 1 && apiCalls.deletes[0] === '/channels/chan-1/messages/old-msg-99');
    {
      const post = apiCalls.posts[0];
      const embed = post && post.body.embeds[0];
      const button = post && post.body.components[0].components[0];
      check('success: new panel uses current stored label',
        !!post && post.url === '/channels/chan-1/messages'
        && embed.title === '🎫 Support'
        && embed.description.includes('Send a Raven')
        && !embed.description.includes('Create Ticket')
        && button.label === 'Send a Raven'
        && button.custom_id === 'ticket_create:7');
    }
    check('success: stored message_id updated to new message',
      queries.some((q) => q.sql.startsWith('UPDATE ticket_panels SET message_id') && q.params[0] === 'new-msg-123' && q.params[1] === 7));
    check('success: staff audit logged',
      queries.some((q) => q.sql.startsWith('INSERT INTO staff_audit') && q.params[1] === 'ticket.repost'));

    // 404 flow: panel gone.
    panelRow = null;
    queries.length = 0; apiCalls.posts.length = 0; apiCalls.deletes.length = 0;
    const res404 = fakeRes();
    await handler({ params: { id: 'g1', panelId: '99' }, session: { user: { id: 'u-staff' } } }, res404);
    check('missing panel: 404, nothing deleted or posted',
      res404.statusCode === 404 && apiCalls.deletes.length === 0 && apiCalls.posts.length === 0);

    // Post-failure flow: old message still deleted, no message_id update, 502.
    panelRow = {
      id: 7, guild_id: 'g1', channel_id: 'chan-1', category_id: null,
      staff_role_id: null, title: 'Support', description: null,
      message_id: 'old-msg-99', created_by: 'u1',
    };
    failPost = true;
    queries.length = 0; apiCalls.posts.length = 0; apiCalls.deletes.length = 0;
    const res502 = fakeRes();
    await handler({ params: { id: 'g1', panelId: '7' }, session: { user: { id: 'u-staff' } } }, res502);
    check('post failure: 502, old message deleted, message_id NOT updated',
      res502.statusCode === 502
      && apiCalls.deletes.length === 1
      && !queries.some((q) => q.sql.startsWith('UPDATE ticket_panels SET message_id')));
    failPost = false;

    // No stored message id: delete skipped, post still happens.
    panelRow.message_id = null;
    queries.length = 0; apiCalls.posts.length = 0; apiCalls.deletes.length = 0;
    const resNoMsg = fakeRes();
    await handler({ params: { id: 'g1', panelId: '7' }, session: { user: { id: 'u-staff' } } }, resNoMsg);
    check('no stored message: delete skipped, repost still succeeds',
      resNoMsg.statusCode === 200 && resNoMsg.body.ok === true && apiCalls.deletes.length === 0 && apiCalls.posts.length === 1);
  } finally {
    try { fs.unlinkSync(tmpDash); } catch {}
    delete require.cache[dbPath];
    delete require.cache[axiosPath];
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  try { fs.unlinkSync(tmpDash); } catch {}
  console.error('VERIFY CRASH:', err);
  process.exit(1);
});
