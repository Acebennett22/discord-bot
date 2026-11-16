// Verify 1.15.33: bulk add + single remove + bulk remove for reaction roles.
// Helpers are exercised against a fake in-memory reaction_roles table, with a
// fake Discord REST adapter standing in for the dashboard's discordApi.
// Route-level behavior is covered by source checks (same approach as 1.15.32).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};

// --- Fake DB: in-memory reaction_roles table ------------------------------
const db = require('../src/utils/database');
const fakeRows = [];
const queries = [];
let nextId = 1;
db.isEnabled = () => true;
db.query = async (sql, params = []) => {
  queries.push({ sql, params: [...params] });
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('SELECT * FROM reaction_roles WHERE message_id = ?')) {
    return fakeRows.filter((r) => r.message_id === params[0]).map((r) => ({ ...r }));
  }
  if (s.startsWith('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?')) {
    return fakeRows.filter((r) => r.guild_id === params[0] && r.message_id === params[1]).map((r) => ({ emoji: r.emoji }));
  }
  if (s.startsWith('SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id = ? ORDER BY message_id')) {
    // 1.15.38: the duplicate check (and the insert lookup) read the same
    // guild-wide rows the list shows, matched in JS.
    return fakeRows.filter((r) => r.guild_id === params[0]).map((r) => ({ ...r }));
  }
  if (s.startsWith('UPDATE reaction_roles SET channel_id = ? WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
    // 1.15.37: channel re-key repair.
    let changed = 0;
    for (const r of fakeRows) {
      if (r.guild_id === params[1] && r.message_id === params[2] && r.emoji === params[3] && r.channel_id !== params[0]) { r.channel_id = params[0]; changed++; }
    }
    return { affectedRows: changed };
  }
  if (s.startsWith('SELECT * FROM reaction_roles WHERE id = ? AND guild_id = ?')) {
    return fakeRows.filter((r) => r.id === Number(params[0]) && r.guild_id === params[1]).map((r) => ({ ...r }));
  }
  if (s.startsWith('SELECT * FROM reaction_roles WHERE guild_id = ? AND id IN (')) {
    const ids = params.slice(1).map(Number);
    return fakeRows.filter((r) => r.guild_id === params[0] && ids.includes(r.id)).map((r) => ({ ...r }));
  }
  if (s.startsWith('INSERT INTO reaction_roles')) {
    const [guild_id, channel_id, message_id, emoji, role_id] = params;
    if (fakeRows.some((r) => r.guild_id === guild_id && r.message_id === message_id && r.emoji === emoji)) {
      const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e;
    }
    fakeRows.push({ id: nextId++, guild_id, channel_id, message_id, emoji, role_id, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
    // 1.15.37: insertMappingRow() verifies affectedRows === 1 on the
    // OkPacket, so the fake returns a realistic one (real mysql2 always
    // carries affectedRows on INSERT).
    return { insertId: nextId - 1, affectedRows: 1 };
  }
  if (s.startsWith('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
    const before = fakeRows.length;
    for (let i = fakeRows.length - 1; i >= 0; i--) {
      const r = fakeRows[i];
      if (r.guild_id === params[0] && r.message_id === params[1] && r.emoji === params[2]) fakeRows.splice(i, 1);
    }
    return { affectedRows: before - fakeRows.length };
  }
  throw new Error(`unexpected query in fake db: ${sql}`);
};

const rr = require('../src/utils/reactionRoles');

const G = '1571439343976058970';
const CH = '111111111111111111';
const CH2 = '111111111111111112';
const MSG = '222222222222222222';
const MSG2 = '222222222222222223';
const BOT_ID = '333333333333333333';
const OTHER_ID = '444444444444444444';
const EMOJIS = [
  { id: '123456789012345678', name: 'viking', animated: false },
  { id: '123456789012345679', name: 'rave', animated: true },
];
function discordErr(status, code, message) {
  const e = new Error(message);
  e.response = { status, data: { code, message } };
  return e;
}
function makeDiscord({ messages, emojis = EMOJIS, patchFailFor = {} } = {}) {
  const calls = { patch: [], getMessage: 0, listEmojis: 0 };
  const msgs = messages || {
    [`${CH}:${MSG}`]: { id: MSG, channel_id: CH, author: { id: BOT_ID } },
    [`${CH2}:${MSG2}`]: { id: MSG2, channel_id: CH2, author: { id: BOT_ID } },
  };
  return {
    calls,
    getMessage: async (chId, msgId) => { calls.getMessage++; return msgs[`${chId}:${msgId}`] || null; },
    listGuildEmojis: async () => { calls.listEmojis++; return emojis; },
    patchMessage: async (chId, msgId, body) => {
      calls.patch.push({ chId, msgId, body });
      if (patchFailFor[msgId]) throw patchFailFor[msgId];
    },
  };
}
const reset = () => { fakeRows.length = 0; queries.length = 0; nextId = 1; };
const inserts = () => queries.filter((q) => q.sql.startsWith('INSERT INTO reaction_roles'));
const row = (channelId, messageId, emoji, roleId) => ({ channelId, messageId, emoji, roleId });

(async () => {
  // --- Bulk add: happy path, grouped refresh ------------------------------
  reset();
  let d = makeDiscord();
  let res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555555'),
    row(CH, MSG, '🎲', '555555555555555556'),
    row(CH2, MSG2, '<:viking:123456789012345678>', '555555555555555557'),
  ] }, d);
  check('bulk add: all three rows ok', res.every((r) => r.ok));
  check('bulk add: 3 rows in table', fakeRows.length === 3);
  check('bulk add: INSERT shape matches /reactionroles-add', inserts().every((q) =>
    q.sql === 'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)'
    && q.params[0] === G && /^\d{17,20}$/.test(q.params[1]) && /^\d{17,20}$/.test(q.params[2])
    && typeof q.params[3] === 'string' && /^\d{17,20}$/.test(q.params[4])));
  check('bulk add: one PATCH per affected message (2, not 3)', d.calls.patch.length === 2);
  check('bulk add: PATCH bodies carry all buttons for their message',
    d.calls.patch.find((p) => p.msgId === MSG).body.components[0].components.length === 2
    && d.calls.patch.find((p) => p.msgId === MSG2).body.components[0].components.length === 1);
  check('bulk add: message fetch cached (2 fetches for 3 rows)', d.calls.getMessage === 2);
  check('bulk add: emoji list fetched once', d.calls.listEmojis === 1);

  // --- Bulk add: one bad row does not block the others ---------------------
  reset();
  d = makeDiscord({ messages: {
    [`${CH}:${MSG}`]: { id: MSG, channel_id: CH, author: { id: BOT_ID } },
    [`${CH2}:${MSG2}`]: { id: MSG2, channel_id: CH2, author: { id: OTHER_ID } },
  } });
  res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555555'),
    row(CH2, MSG2, '🎲', '555555555555555556'),
    row(CH, MSG, '🎵', '555555555555555557'),
  ] }, d);
  check('bad row: good rows ok, bad row failed', res[0].ok && !res[1].ok && res[2].ok);
  check('bad row: reason names the bot-author rule', /wasn't posted by the bot/.test(res[1].error));
  check('bad row: only good rows inserted', fakeRows.length === 2 && fakeRows.every((r) => r.emoji !== '🎲'));
  check('bad row: only good message refreshed', d.calls.patch.length === 1 && d.calls.patch[0].msgId === MSG);

  // --- Bulk add: intra-batch duplicate --------------------------------------
  reset();
  d = makeDiscord();
  res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555555'),
    row(CH, MSG, '🎮', '555555555555555556'),
    row(CH, MSG, '🎲', '555555555555555557'),
  ] }, d);
  check('intra-batch dup: first ok, dup rejected', res[0].ok && !res[1].ok && res[2].ok);
  check('intra-batch dup: reason says twice in batch', /twice for this message in this batch/.test(res[1].error));
  check('intra-batch dup: only one insert for the emoji', fakeRows.filter((r) => r.emoji === '🎮').length === 1);

  // --- Bulk add: duplicate against the DB -----------------------------------
  reset();
  fakeRows.push({ id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  d = makeDiscord();
  res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555559'),
    row(CH, MSG, '🎲', '555555555555555556'),
  ] }, d);
  check('DB dup: pre-existing mapping rejected', !res[0].ok && /already mapped/.test(res[0].error));
  check('DB dup: other row still saved', res[1].ok && fakeRows.length === 2);

  // --- Bulk add: PATCH failure rolls back only that message's rows ----------
  reset();
  d = makeDiscord({ patchFailFor: { [MSG2]: discordErr(400, 50035, 'Invalid Form Body') } });
  res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555555'),
    row(CH2, MSG2, '🎲', '555555555555555556'),
  ] }, d);
  check('PATCH fail: good message row kept', res[0].ok && fakeRows.some((r) => r.message_id === MSG));
  check('PATCH fail: failed message row rolled back', !res[1].ok && !fakeRows.some((r) => r.message_id === MSG2));
  check('PATCH fail: reason says mapping not kept', /not kept/.test(res[1].error));

  // --- Bulk add: missing message --------------------------------------------
  reset();
  d = makeDiscord({ messages: { [`${CH}:${MSG}`]: { id: MSG, channel_id: CH, author: { id: BOT_ID } } } });
  res = await rr.addMappingsBatch({ guildId: G, botUserId: BOT_ID, rows: [
    row(CH, MSG, '🎮', '555555555555555555'),
    row(CH2, MSG2, '🎲', '555555555555555556'),
  ] }, d);
  check('missing message: row fails with exists reason', !res[1].ok && /does not exist/.test(res[1].error));
  check('missing message: good row still saved', res[0].ok && fakeRows.length === 1);

  // --- Single add still works (refactored addMapping) -----------------------
  reset();
  d = makeDiscord();
  const single = await rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d);
  check('single add: returns message/channel', single.messageId === MSG && single.channelId === CH);
  check('single add: one insert + one PATCH', inserts().length === 1 && d.calls.patch.length === 1);
  reset();
  d = makeDiscord({ patchFailFor: { [MSG]: discordErr(400, 50035, 'Invalid Form Body') } });
  let threw = null;
  try { await rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d); } catch (e) { threw = e; }
  check('single add: PATCH failure rolls back + 502', threw && threw.status === 502 && fakeRows.length === 0);
  reset();
  fakeRows.push({ id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  d = makeDiscord();
  threw = null;
  try { await rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555559', botUserId: BOT_ID }, d); } catch (e) { threw = e; }
  check('single add: duplicate still 400s with no insert', threw && threw.status === 400 && fakeRows.length === 1);

  // --- Single remove ---------------------------------------------------------
  reset();
  fakeRows.push(
    { id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
    { id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎲', role_id: '555555555555555556', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  );
  d = makeDiscord();
  let rm = await rr.removeMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮' }, d);
  check('single remove: ok, message not gone', rm.messageGone === false);
  check('single remove: row deleted, other kept', fakeRows.length === 1 && fakeRows[0].emoji === '🎲');
  check('single remove: one PATCH with only the remaining button',
    d.calls.patch.length === 1 && d.calls.patch[0].body.components[0].components.length === 1
    // 1.15.36: button labels are role names (or the role ID when the name
    // cannot be resolved — this mock adapter has no role list, so the
    // fallback label is the role ID, not the emoji).
    && d.calls.patch[0].body.components[0].components[0].label === '555555555555555556');
  reset();
  fakeRows.push({ id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  d = makeDiscord({ patchFailFor: { [MSG]: discordErr(404, 10008, 'Unknown Message') } });
  rm = await rr.removeMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮' }, d);
  check('single remove: message gone still succeeds', rm.messageGone === true && fakeRows.length === 0);
  reset();
  fakeRows.push({ id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  d = makeDiscord({ patchFailFor: { [MSG]: discordErr(403, 50001, 'Missing Access') } });
  rm = await rr.removeMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮' }, d);
  check('single remove: non-gone PATCH failure warns, row still deleted', rm.messageGone === false && /linger/.test(rm.warning || '') && fakeRows.length === 0);

  // --- Bulk remove -----------------------------------------------------------
  reset();
  fakeRows.push(
    { id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
    { id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎲', role_id: '555555555555555556', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
    { id: nextId++, guild_id: G, channel_id: CH2, message_id: MSG2, emoji: '🎵', role_id: '555555555555555557', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  );
  d = makeDiscord();
  let br = await rr.removeMappingsBatch({ guildId: G, rows: fakeRows.map((r) => ({ channelId: r.channel_id, messageId: r.message_id, emoji: r.emoji })) }, d);
  check('bulk remove: all rows ok', br.every((r) => r.ok));
  check('bulk remove: all rows deleted', fakeRows.length === 0);
  check('bulk remove: one PATCH per affected message (2)', d.calls.patch.length === 2);
  reset();
  fakeRows.push(
    { id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji: '🎮', role_id: '555555555555555555', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
    { id: nextId++, guild_id: G, channel_id: CH2, message_id: MSG2, emoji: '🎵', role_id: '555555555555555557', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  );
  d = makeDiscord({ patchFailFor: { [MSG2]: discordErr(404, 10008, 'Unknown Message') } });
  br = await rr.removeMappingsBatch({ guildId: G, rows: fakeRows.map((r) => ({ channelId: r.channel_id, messageId: r.message_id, emoji: r.emoji })) }, d);
  check('bulk remove: message-gone rows still removed + flagged', br[1].ok && br[1].messageGone === true && fakeRows.length === 0);
  check('bulk remove: empty batch returns [] with no PATCH', (await rr.removeMappingsBatch({ guildId: G, rows: [] }, d)).length === 0);

  // --- Routes (source checks) -------------------------------------------------
  const dash = read('src/dashboard.js');
  check('route: POST accepts mappings array', dash.includes("Array.isArray(body.mappings)"));
  check('route: batch capped at 25', dash.includes('Add at most 25 reaction roles at once.'));
  check('route: single shape still returns old fields', dash.includes("return res.json({ ok: true, messageId: row.messageId, channelId: row.channelId, channelName: row.channelName, roleName: row.roleName, emoji: row.emoji })"));
  check('route: DELETE single exists + gated', /app\.delete\('\/api\/guilds\/:id\/reaction-roles\/:mappingId', requireAuth, requireGuildAccess/.test(dash));
  check('route: DELETE single 404s on unknown mapping', dash.includes("return res.status(404).json({ error: 'That mapping no longer exists.' })"));
  check('route: DELETE single audits reaction-role.remove', dash.includes("'reaction-role.remove'"));
  check('route: bulk-delete exists + gated', /app\.post\('\/api\/guilds\/:id\/reaction-roles\/bulk-delete', requireAuth, requireGuildAccess/.test(dash));
  check('route: bulk-delete calls removeMappingsBatch', dash.includes('removeMappingsBatch({ guildId, rows: helperRows }'));
  check('route: bulk-delete reports not-found per id', dash.includes("return { id, ok: false, error: 'not-found' }"));
  check('route: list query selects mapping id', dash.includes('SELECT id, message_id, channel_id, emoji, role_id'));

  // --- EJS + client ------------------------------------------------------------
  const ejs = read('dashboard/views/settings.ejs');
  check('ejs: rows container + add-another button', ejs.includes('id="rr-rows"') && ejs.includes('id="rr-add-row"'));
  check('ejs: row remove buttons', ejs.includes('data-rr-remove'));
  check('ejs: per-row checkboxes + select-all + remove-selected', ejs.includes('class="rr-select"') && ejs.includes('id="rr-select-all"') && ejs.includes('id="rr-remove-selected"'));
  check('ejs: per-row Remove button with mapping id', ejs.includes('data-remove-reaction-role="<%= m.id %>"'));
  const js = read('dashboard/public/js/settings.js');
  check('js: multi-row submit posts { mappings }', js.includes("await AceBot.postJSON(api('/reaction-roles'), { mappings: rows })"));
  check('js: single row still posts the single shape', js.includes("await AceBot.postJSON(api('/reaction-roles'), rows[0])"));
  check('js: per-row results rendered', js.includes("`✅ Row ${i + 1}:") && js.includes("`❌ Row ${i + 1}:"));
  check('js: add/remove row handlers', js.includes("closest('#rr-add-row')") && js.includes("closest('[data-rr-remove]')"));
  check('js: single remove handler (confirm + del)', js.includes("closest('[data-remove-reaction-role]')") && js.includes("AceBot.del(api(`/reaction-roles/${rrRemoveOne.dataset.removeReactionRole}`))"));
  check('js: select-all + bulk remove handlers', js.includes("closest('#rr-select-all')") && js.includes("api('/reaction-roles/bulk-delete')"));
  check('js: add-row capped at 25', js.includes('rows.length >= 25'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
