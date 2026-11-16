// Verify 1.15.36: reaction-role buttons show emoji + role name, plus the
// dashboard "Refresh buttons" action per message group.
// Helpers are exercised against a fake in-memory reaction_roles table, with
// a fake Discord REST adapter standing in for the dashboard's discordApi.
// The route/EJS/client pieces are covered by rendering the real template
// and by source checks (same approach as 1.15.32–1.15.35).
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// --- Fake DB: in-memory reaction_roles table (same shape as 1.15.33) -------
const db = require('../src/utils/database');
const fakeRows = [];
let nextId = 1;
db.isEnabled = () => true;
db.query = async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('SELECT * FROM reaction_roles WHERE message_id = ?')) {
    return fakeRows.filter((r) => r.message_id === params[0]).map((r) => ({ ...r }));
  }
  if (s.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ?')) {
    return fakeRows.filter((r) => r.guild_id === params[0] && r.channel_id === params[1] && r.message_id === params[2]).map((r) => ({ id: r.id }));
  }
  throw new Error(`unexpected query in fake db: ${sql}`);
};

const rr = require('../src/utils/reactionRoles');

const G = '1571439343976058970';
const CH = '1571556681320632520'; // #choose-your-rank
const MSG = '1571727320597663745'; // Choose Your Path embed
const ROLES = [
  ['💻', 'PC Warrior', '555555555555555551'],
  ['🟢', 'Xbox Warrior', '555555555555555552'],
  ['🔵', 'PlayStation Warrior', '555555555555555553'],
  ['🍄', 'Nintendo Wanderer', '555555555555555554'],
  ['💜', 'Twitch Creator', '555555555555555555'],
  ['▶️', 'YouTube Creator', '555555555555555556'],
  ['🎵', 'TikTok Creator', '555555555555555557'],
  ['🎲', 'Variety Gamer', '555555555555555558'],
  ['📜', 'Norse Lore Seeker', '555555555555555559'],
  ['🌙', 'Late-Night Raven', '555555555555555560'],
  ['🔔', "Raven's Herald", '555555555555555561'],
];
function seed(rows) {
  fakeRows.length = 0; nextId = 1;
  for (const [emoji, , roleId] of rows) {
    fakeRows.push({ id: nextId++, guild_id: G, channel_id: CH, message_id: MSG, emoji, role_id: roleId, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  }
}
function discordErr(status, code, message) {
  const e = new Error(message);
  e.response = { status, data: { code, message } };
  return e;
}
function makeDiscord({ roles, patchFailFor = {} } = {}) {
  const calls = { patch: [], listRoles: 0 };
  return {
    calls,
    getMessage: async () => ({ id: MSG, channel_id: CH, author: { id: '333333333333333333' } }),
    listGuildEmojis: async () => [],
    listGuildRoles: async (gId) => { calls.listRoles++; return (roles || []).map(([id, name]) => ({ id, name })); },
    patchMessage: async (chId, msgId, body) => {
      calls.patch.push({ chId, msgId, body });
      if (patchFailFor[msgId]) throw patchFailFor[msgId];
    },
  };
}
const rolePairs = ROLES.map(([, name, id]) => [id, name]);
const restResolver = (d) => rr.roleNameResolverFromRest(d, G);
const flatButtons = (rows) => rows.flatMap((r) => r.components.map((c) => c.toJSON()));

(async () => {
  // --- emojiButton: label is the role name, emoji kept, customId kept -----
  console.log('== emojiButton ==');
  let b = rr.emojiButton('💻', '555555555555555551', 'PC Warrior').toJSON();
  check('unicode button: label is the role name', b.label === 'PC Warrior', JSON.stringify(b));
  check('unicode button: emoji is set', b.emoji && b.emoji.name === '💻', JSON.stringify(b));
  check('unicode button: customId unchanged', b.custom_id === 'rr:555555555555555551');
  b = rr.emojiButton('<:viking:123456789012345678>', '555555555555555551', 'Vikings').toJSON();
  check('custom emoji button: label is the role name', b.label === 'Vikings');
  check('custom emoji button: emoji id is set', b.emoji && b.emoji.id === '123456789012345678', JSON.stringify(b));
  check('custom emoji button: customId unchanged', b.custom_id === 'rr:555555555555555551');
  b = rr.emojiButton('🎲', '555555555555555556', null).toJSON();
  check('unresolvable role: label falls back to role ID', b.label === '555555555555555556');
  b = rr.emojiButton('🎲', '555555555555555556', 'x'.repeat(120)).toJSON();
  check('over-long role name: label truncated to 80 chars', b.label.length === 80);

  // --- buildRows: 11 mappings, new-style buttons, chunking -----------------
  console.log('== buildRows (11 mappings, REST resolver) ==');
  seed(ROLES);
  let d = makeDiscord({ roles: rolePairs });
  let rows = await rr.buildRows(MSG, restResolver(d));
  let btns = flatButtons(rows);
  check('11 mappings -> 3 rows (5/5/1)', rows.length === 3 && rows[0].components.length === 5 && rows[1].components.length === 5 && rows[2].components.length === 1, `rows=${rows.length}`);
  check('11 buttons built', btns.length === 11, `got ${btns.length}`);
  check('every button label is its role name', ROLES.every(([emoji, name, id]) => btns.some((x) => x.custom_id === `rr:${id}` && x.label === name)));
  check('every button carries its emoji', ROLES.every(([emoji, , id]) => btns.some((x) => x.custom_id === `rr:${id}` && x.emoji && x.emoji.name === emoji)));
  check('role list fetched once for all 11 (cached)', d.calls.listRoles === 1, `calls=${d.calls.listRoles}`);

  // --- buildRows: no resolver / unresolvable role -> role-ID fallback -------
  console.log('== buildRows fallbacks ==');
  seed(ROLES);
  rows = await rr.buildRows(MSG);
  btns = flatButtons(rows);
  check('no resolver: all labels fall back to role IDs, no throw', btns.length === 11 && btns.every((x) => /^\d{18}$/.test(x.label)));
  seed(ROLES);
  d = makeDiscord({ roles: [['555555555555555551', 'PC Warrior']] }); // only one role resolves
  rows = await rr.buildRows(MSG, restResolver(d));
  btns = flatButtons(rows);
  check('partial resolver: resolved name used, rest fall back to IDs', btns.some((x) => x.label === 'PC Warrior') && btns.filter((x) => /^\d{18}$/.test(x.label)).length === 10);
  const throwingResolver = async () => { throw new Error('boom'); };
  rows = await rr.buildRows(MSG, throwingResolver);
  check('throwing resolver: buildRows still completes with ID labels', flatButtons(rows).length === 11);

  // --- buildRows: disabled state unchanged ----------------------------------
  console.log('== buildRows disabled state ==');
  seed(ROLES);
  fakeRows[0].enabled = 0;
  d = makeDiscord({ roles: rolePairs });
  rows = await rr.buildRows(MSG, restResolver(d));
  btns = flatButtons(rows);
  check('any mapping disabled -> all buttons disabled', btns.every((x) => x.disabled === true));
  check('disabled buttons still show role-name labels', btns.some((x) => x.label === 'PC Warrior'));

  // --- Guild resolver (bot path) --------------------------------------------
  console.log('== roleNameResolverFromGuild ==');
  const fakeGuild = {
    roles: {
      cache: new Map([['555555555555555551', { name: 'PC Warrior' }]]),
      fetch: async (id) => {
        if (id === undefined) return new Map([['555555555555555552', { name: 'Xbox Warrior' }]]);
        return null;
      },
    },
  };
  // Map.get works on the cache Map; fetch() with no args returns the full Map.
  const guildResolver = rr.roleNameResolverFromGuild(fakeGuild);
  check('guild resolver: cache hit resolves', (await guildResolver('555555555555555551')) === 'PC Warrior');
  check('guild resolver: cache miss falls back to fetch-all', (await guildResolver('555555555555555552')) === 'Xbox Warrior');
  check('guild resolver: unknown role -> null', (await guildResolver('999999999999999999')) === null);

  // --- refreshMessageButtons via the REST adapter ---------------------------
  console.log('== refreshMessageButtons ==');
  seed(ROLES);
  d = makeDiscord({ roles: rolePairs });
  await rr.refreshMessageButtons(CH, MSG, d, G);
  check('refresh: one PATCH to the right channel/message', d.calls.patch.length === 1 && d.calls.patch[0].chId === CH && d.calls.patch[0].msgId === MSG);
  const patched = d.calls.patch[0].body.components.flatMap((r) => r.components);
  check('refresh: PATCH carries all 11 new-style buttons', patched.length === 11 && patched.every((x) => ROLES.some(([, name, id]) => x.custom_id === `rr:${id}` && x.label === name)), `got ${patched.length}`);
  seed(ROLES);
  const noRolesAdapter = { patchMessage: async (chId, msgId, body) => { d.calls.patch.push({ chId, msgId, body }); } };
  await rr.refreshMessageButtons(CH, MSG, noRolesAdapter, G);
  check('refresh: adapter without listGuildRoles still patches (ID labels)', d.calls.patch.length === 2);
  seed(ROLES);
  d = makeDiscord({ roles: rolePairs, patchFailFor: { [MSG]: discordErr(404, 10008, 'Unknown Message') } });
  let threw = null;
  try { await rr.refreshMessageButtons(CH, MSG, d, G); } catch (e) { threw = e; }
  check('refresh: gone message surfaces the 404 (route maps it)', threw && threw.response && threw.response.status === 404);

  // --- EJS: Refresh buttons per message group -------------------------------
  console.log('== settings.ejs Refresh buttons ==');
  const TEMPLATE = path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs');
  const locals = {
    guild: { id: G, name: "THE VIKING'S LONGHOUSE", icon: null },
    saved: false, module: 'reactionroles', settings: {},
    channels: [{ id: CH, name: 'choose-your-rank', type: 0 }, { id: '222', name: 'general', type: 0 }],
    roles: rolePairs.map(([id, name]) => ({ id, name })),
    reactionRoleMappings: [
      { id: 1, message_id: MSG, channel_id: CH, emoji: '💻', role_id: '555555555555555551', required_role_id: null, min_days_in_server: null, min_level: null },
      { id: 2, message_id: MSG, channel_id: CH, emoji: '🟢', role_id: '555555555555555552', required_role_id: null, min_days_in_server: null, min_level: null },
      { id: 3, message_id: '999999999999999999', channel_id: '222', emoji: '🎲', role_id: '555555555555555558', required_role_id: null, min_days_in_server: null, min_level: null },
    ],
    emojis: [],
  };
  const html = await ejs.renderFile(TEMPLATE, locals);
  check('one Refresh button per message group (2 groups)', (html.match(/data-refresh-reaction-roles/g) || []).length === 2, `got ${(html.match(/data-refresh-reaction-roles/g) || []).length}`);
  check('refresh button carries channel + message ids', html.includes(`data-rr-channel="${CH}"`) && html.includes(`data-rr-message="${MSG}"`));
  check('group header shows channel name + role count', html.includes('#choose-your-rank') && html.includes('2 role(s)'));
  check('1.15.35 mapping rows unchanged (#channel · Role · emoji)', html.includes('#choose-your-rank · PC Warrior · 💻'));
  check('per-row Remove buttons still present', html.includes('data-remove-reaction-role="1"') && html.includes('data-remove-reaction-role="3"'));

  // --- Route + client source checks ------------------------------------------
  console.log('== refresh route + client ==');
  const dash = read('src/dashboard.js');
  check('refresh route exists with auth gating', /app\.post\('\/api\/guilds\/:id\/reaction-roles\/refresh', requireAuth, requireGuildAccess/.test(dash));
  check('refresh route: adapter gains listGuildRoles', /listGuildRoles: async \(gId\)/.test(dash) && dash.includes('/guilds/${gId}/roles'));
  check('refresh route: audit-logged as reaction-role.refresh', dash.includes("'reaction-role.refresh'"));
  check('refresh route: no-mappings 404', dash.includes('No reaction-role mappings for that message in this server.'));
  check('refresh route: gone message reported (404/10008)', dash.includes('That message no longer exists in Discord'));
  const client = read('dashboard/public/js/settings.js');
  check('client: refresh click handler posts channel + message', client.includes("api('/reaction-roles/refresh')") && client.includes('data-refresh-reaction-roles'));
  check('client: refresh toasts the re-applied count', /Buttons refreshed/.test(client));

  // --- Bot command callers pass the guild resolver ---------------------------
  console.log('== bot command callers ==');
  for (const f of ['reactionroles-setup', 'reactionroles-add', 'reactionroles-remove', 'reactionroles-toggle']) {
    const src = read(`src/commands/reactionroles/${f}.js`);
    check(`${f}: buildRows uses the guild resolver`, src.includes('roleNameResolverFromGuild(interaction.guild)'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
