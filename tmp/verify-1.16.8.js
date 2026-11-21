// Verify 1.16.8 (revised): per-server bot identity — nickname command,
// dashboard-only avatar, per-guild command prefix.
// Exercises the REAL botIdentity + dashboardIdentity utils, the REAL
// /botidentity command, the REAL guildSettings/guildPrefixes utils and the
// REAL settings.ejs identity section, with an in-memory fake for
// src/utils/database (no live MySQL in this sandbox) and mocked guild
// members / Discord REST. Never touches the live bot or dashboard.
'use strict';

// The sandbox config.json holds placeholder credentials, and config.js
// exits on them — the dashboard's own setup-wizard escape hatch
// (ALLOW_PLACEHOLDER_CONFIG=1) is the documented way to load code without
// a real token. All Discord calls here are mocked; nothing real is reached.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

// --- Fake database (in-memory guild_bot_identity + guild_settings) ---------
const store = { identity: new Map(), guildSettings: new Map() };
let dbEnabled = true;
let failWrites = false;
const fakeDb = {
  isEnabled: () => dbEnabled,
  query: async (sql, params = []) => {
    const s = String(sql);
    if (!dbEnabled) return [];
    // DELETE must be matched before SELECT: it also contains the table name.
    if (s.startsWith('DELETE FROM guild_bot_identity')) {
      store.identity.delete(String(params[0]));
      return { affectedRows: 1 };
    }
    if (s.includes('FROM guild_bot_identity')) {
      const row = store.identity.get(String(params[0]));
      return row ? [{ ...row }] : [];
    }
    if (s.startsWith('INSERT INTO guild_bot_identity')) {
      if (failWrites) return { affectedRows: 0 };
      const id = String(params[0]);
      const row = store.identity.get(id) || { guild_id: id, nickname: null, avatar_path: null, updated_at: new Date().toISOString() };
      if (s.includes('(guild_id, nickname)')) row.nickname = params[1];
      if (s.includes('(guild_id, avatar_path)')) row.avatar_path = params[1];
      row.updated_at = new Date().toISOString();
      store.identity.set(id, row);
      return { affectedRows: 1 };
    }
    if (s.trimStart().startsWith('SELECT') && s.includes('FROM guild_settings')) {
      if (s.includes('SELECT guild_id, prefix')) {
        // loadGuildPrefixes: every stored non-empty prefix.
        return [...store.guildSettings.values()]
          .filter((r) => r.prefix)
          .map((r) => ({ guild_id: r.guild_id, prefix: r.prefix }));
      }
      const cols = s.slice(s.indexOf('SELECT') + 6, s.indexOf('FROM')).split(',').map((c) => c.trim());
      const row = store.guildSettings.get(String(params[0]));
      if (!row) return [];
      const out = {};
      for (const c of cols) out[c] = row[c] ?? null;
      return [out];
    }
    if (s.startsWith('INSERT INTO guild_settings')) {
      if (failWrites) return { affectedRows: 0 };
      const cols = s.match(/INSERT INTO guild_settings \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = params[i]; });
      row.guild_id = String(params[0]);
      store.guildSettings.set(row.guild_id, row);
      return { affectedRows: 1 };
    }
    return [];
  },
  queryDetailed: async (sql, params = []) => {
    if (!dbEnabled) return { rows: null, error: null };
    if (failWrites) return { rows: null, error: { message: 'fake db write failed' } };
    const rows = await fakeDb.query(sql, params);
    return { rows, error: null };
  },
};

// Install the stub BEFORE requiring anything that loads src/utils/database.
const dbPath = require.resolve('../src/utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const botIdentity = require('../src/utils/botIdentity');
const dashboardIdentity = require('../src/utils/dashboardIdentity');
const guildSettings = require('../src/utils/guildSettings');
const guildPrefixes = require('../src/utils/guildPrefixes');
const command = require('../src/commands/botidentity/botidentity');
const { PermissionFlagsBits } = require('discord.js');

// --- Test harness -----------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

// --- Mocks ------------------------------------------------------------------
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const GIF = Buffer.from('GIF89a............', 'latin1');
const TEXT = Buffer.from('hello, this is not an image at all');

function mockMember({ nickname = null, avatar = null, canChange = true, failSetNickname = null } = {}) {
  const state = { nickname };
  const calls = { setNickname: [], setAvatar: [] };
  return {
    calls,
    get nickname() { return state.nickname; },
    avatar,
    permissions: { has: () => canChange },
    displayAvatarURL: () => 'https://cdn.example/avatars/x.png',
    setNickname: async (name) => {
      calls.setNickname.push(name);
      if (!canChange) { const e = new Error('Missing Permissions'); e.code = 50013; e.status = 403; throw e; }
      if (failSetNickname) throw failSetNickname;
      state.nickname = name;
    },
    setAvatar: async (buf) => {
      calls.setAvatar.push(buf);
      if (!canChange) { const e = new Error('Missing Permissions'); e.code = 50013; e.status = 403; throw e; }
    },
  };
}

function mockGuild(member, id = '111') {
  return { id, members: { me: member, fetchMe: async () => member } };
}

function mockInteraction({ sub, guild, name = null }) {
  const replies = [];
  return {
    guild,
    guildId: guild.id,
    client: { user: { username: 'Vikings Hall Clerk' } },
    options: {
      getSubcommand: () => sub,
      getString: (k) => (k === 'name' ? name : null),
      getAttachment: () => null,
    },
    replies,
    reply: async (o) => { replies.push({ type: 'reply', ...o }); },
    deferReply: async () => { replies.push({ type: 'defer' }); },
    editReply: async (o) => { replies.push({ type: 'edit', ...o }); },
  };
}

function mockRest({ member = null, patchError = null, getError = null } = {}) {
  const calls = { get: [], patch: [] };
  let memberState = member;
  return {
    calls,
    get: async (url) => {
      calls.get.push(url);
      if (getError) throw getError;
      return { data: memberState };
    },
    patch: async (url, data) => {
      calls.patch.push({ url, data });
      if (patchError) throw patchError;
      if (data && 'nick' in data) memberState = { ...memberState, nick: data.nick };
      if (data && 'avatar' in data) memberState = { ...memberState, avatar: data.avatar === null ? null : 'newhash123' };
      return { data: memberState };
    },
  };
}

function restMember({ userId = '222', username = 'Vikings Hall Clerk', userAvatar = 'globalhash', nick = null, guildAvatar = null } = {}) {
  return { user: { id: userId, username, avatar: userAvatar }, nick, avatar: guildAvatar };
}

function resetStore() {
  store.identity.clear();
  store.guildSettings.clear();
  // guildSettings caches reads for 60s — clear it too, or a prefix set in
  // an earlier test leaks into the next one.
  for (const gid of ['111', '222', '333', '999']) guildSettings.invalidate(gid);
  dbEnabled = true;
  failWrites = false;
}

(async () => {
  // --- botIdentity: image validation ---------------------------------------
  await check('detectImageType: PNG/JPG/GIF by magic bytes, text rejected', () => {
    assert.strictEqual(botIdentity.detectImageType(PNG), 'png');
    assert.strictEqual(botIdentity.detectImageType(JPG), 'jpg');
    assert.strictEqual(botIdentity.detectImageType(GIF), 'gif');
    assert.strictEqual(botIdentity.detectImageType(TEXT), null);
    assert.strictEqual(botIdentity.detectImageType(Buffer.alloc(2)), null);
  });

  await check('validateAvatarBuffer: valid PNG ok, oversize/text/empty rejected', () => {
    assert.strictEqual(botIdentity.validateAvatarBuffer(PNG), 'png');
    assert.strictEqual(botIdentity.validateAvatarBuffer(JPG), 'jpg');
    assert.strictEqual(botIdentity.validateAvatarBuffer(GIF), 'gif');
    assert.throws(() => botIdentity.validateAvatarBuffer(Buffer.alloc(8 * 1024 * 1024 + 1)), /limit is 8 MB/);
    assert.throws(() => botIdentity.validateAvatarBuffer(TEXT), /not a PNG, JPG, or GIF/);
    assert.throws(() => botIdentity.validateAvatarBuffer(Buffer.alloc(0)), /not an image/);
    assert.throws(() => botIdentity.validateAvatarBuffer('nope'), /not an image/);
  });

  await check('saveAvatarFile + resolveAvatarPath roundtrip, deleteAvatarFiles removes', () => {
    const gid = 'verify-1-16-8-file';
    const stored = botIdentity.saveAvatarFile(gid, PNG, 'png');
    assert.strictEqual(stored, path.join('src', 'data', 'guild-avatars', `${gid}.png`));
    assert.ok(fs.existsSync(botIdentity.avatarFilePath(gid, 'png')));
    assert.deepStrictEqual(fs.readFileSync(botIdentity.resolveAvatarPath(stored)), PNG);
    botIdentity.saveAvatarFile(gid, JPG, 'jpg');
    assert.ok(!fs.existsSync(botIdentity.avatarFilePath(gid, 'png')), 'old extension not deleted');
    assert.ok(fs.existsSync(botIdentity.avatarFilePath(gid, 'jpg')));
    botIdentity.deleteAvatarFiles(gid);
    assert.ok(!fs.existsSync(botIdentity.avatarFilePath(gid, 'jpg')));
  });

  // --- botIdentity: DB roundtrip -------------------------------------------
  await check('DB roundtrip: nickname + avatar path coexist, clears are independent', async () => {
    resetStore();
    const gid = '111';
    assert.strictEqual(await botIdentity.getIdentity(gid), null);
    assert.strictEqual(await botIdentity.setNicknameRow(gid, 'Hall Clerk'), null);
    assert.strictEqual(await botIdentity.setAvatarPathRow(gid, 'src/data/guild-avatars/111.png'), null);
    let row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, 'Hall Clerk');
    assert.strictEqual(row.avatar_path, 'src/data/guild-avatars/111.png');
    await botIdentity.clearNicknameRow(gid);
    row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, null, 'nickname clear wiped the row');
    assert.strictEqual(row.avatar_path, 'src/data/guild-avatars/111.png', 'avatar path lost on nickname clear');
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    await botIdentity.clearAvatarPathRow(gid);
    row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.avatar_path, null, 'avatar clear wiped the row');
    assert.strictEqual(row.nickname, 'Hall Clerk', 'nickname lost on avatar clear');
    await botIdentity.deleteIdentityRow(gid);
    assert.strictEqual(await botIdentity.getIdentity(gid), null);
  });

  await check('DB roundtrip: clearing the last half deletes the row entirely', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    await botIdentity.clearNicknameRow('111');
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
    await botIdentity.setAvatarPathRow('111', 'src/data/guild-avatars/111.png');
    await botIdentity.clearAvatarPathRow('111');
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
  });

  await check('setNicknameRow surfaces a DB write failure instead of hiding it', async () => {
    resetStore();
    failWrites = true;
    try {
      const err = await botIdentity.setNicknameRow('111', 'Hall Clerk');
      assert.ok(err && /fake db write failed/.test(err.message));
      assert.strictEqual(await botIdentity.getIdentity('111'), null, 'failed write still landed');
    } finally { failWrites = false; }
  });

  // --- botIdentity: live apply / reapply / split resets ---------------------
  await check('applyIdentity: nickname + avatar applied from the stored row', async () => {
    resetStore();
    const gid = 'verify-1-16-8-apply';
    const member = mockMember();
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const res = await botIdentity.applyIdentity(mockGuild(member, gid));
    assert.strictEqual(res.applied, true);
    assert.deepStrictEqual(member.calls.setNickname, ['Hall Clerk']);
    assert.strictEqual(member.calls.setAvatar.length, 1);
    assert.deepStrictEqual(member.calls.setAvatar[0], PNG);
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('applyIdentity: no identity stored applies nothing and never throws', async () => {
    resetStore();
    const member = mockMember();
    const res = await botIdentity.applyIdentity(mockGuild(member, '999'));
    assert.strictEqual(res.applied, false);
    assert.deepStrictEqual(member.calls.setNickname, []);
    assert.deepStrictEqual(member.calls.setAvatar, []);
  });

  await check('applyIdentity: missing Change Nickname permission skips the guild', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    const member = mockMember({ canChange: false });
    const res = await botIdentity.applyIdentity(mockGuild(member, '111'));
    assert.strictEqual(res.applied, false);
    assert.match(res.reason, /Change Nickname/);
    assert.deepStrictEqual(member.calls.setNickname, []);
  });

  await check('applyIdentity: missing avatar file still applies the nickname', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    await botIdentity.setAvatarPathRow('111', 'src/data/guild-avatars/111.png');
    const member = mockMember();
    const res = await botIdentity.applyIdentity(mockGuild(member, '111'));
    assert.strictEqual(res.applied, true);
    assert.deepStrictEqual(member.calls.setNickname, ['Hall Clerk']);
    assert.deepStrictEqual(member.calls.setAvatar, [], 'setAvatar called with a missing file');
  });

  await check('reapplyAllIdentities: only guilds with a stored identity are touched', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    const m1 = mockMember();
    const m2 = mockMember();
    const client = { guilds: { cache: new Map([['111', mockGuild(m1, '111')], ['222', mockGuild(m2, '222')]]) } };
    await botIdentity.reapplyAllIdentities(client);
    assert.deepStrictEqual(m1.calls.setNickname, ['Hall Clerk']);
    assert.deepStrictEqual(m2.calls.setNickname, []);
  });

  await check('resetNickname: clears the live nickname only — avatar untouched', async () => {
    resetStore();
    const gid = 'verify-1-16-8-rn';
    const member = mockMember({ nickname: 'Hall Clerk', avatar: 'guildhash' });
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const res = await botIdentity.resetNickname(mockGuild(member, gid));
    assert.strictEqual(res.hadStored, true);
    assert.deepStrictEqual(res.errors, []);
    assert.deepStrictEqual(member.calls.setNickname, [null]);
    assert.deepStrictEqual(member.calls.setAvatar, [], 'reset touched the avatar');
    assert.strictEqual(member.nickname, null);
    const row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, null);
    assert.strictEqual(row.avatar_path, botIdentity.storedAvatarPath(gid, 'png'), 'avatar path lost on nickname reset');
    assert.ok(fs.existsSync(botIdentity.avatarFilePath(gid, 'png')), 'avatar file deleted on nickname reset');
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('resetAvatar: clears the live avatar only — nickname untouched', async () => {
    resetStore();
    const gid = 'verify-1-16-8-ra';
    const member = mockMember({ nickname: 'Hall Clerk', avatar: 'guildhash' });
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const res = await botIdentity.resetAvatar(mockGuild(member, gid));
    assert.strictEqual(res.hadStored, true);
    assert.deepStrictEqual(res.errors, []);
    assert.deepStrictEqual(member.calls.setAvatar, [null]);
    assert.deepStrictEqual(member.calls.setNickname, [], 'reset touched the nickname');
    const row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, 'Hall Clerk', 'nickname lost on avatar reset');
    assert.strictEqual(row.avatar_path, null);
    assert.ok(!fs.existsSync(botIdentity.avatarFilePath(gid, 'png')), 'avatar file kept on avatar reset');
  });

  await check('resetNickname: missing own member reports an error and keeps the row', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    const guild = { id: '111', members: { me: null, fetchMe: async () => null } };
    const res = await botIdentity.resetNickname(guild);
    assert.strictEqual(res.hadStored, false);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual((await botIdentity.getIdentity('111')).nickname, 'Hall Clerk');
  });

  await check('describeDiscordError: permission / rate limit / rejected value in plain words', () => {
    const e403 = new Error('Missing Permissions'); e403.code = 50013; e403.status = 403;
    assert.match(botIdentity.describeDiscordError(e403), /Change Nickname/);
    const e429 = new Error('rate limited'); e429.status = 429;
    assert.match(botIdentity.describeDiscordError(e429), /rate-limiting/);
    const e400 = new Error('Invalid Form Body'); e400.code = 50035;
    assert.match(botIdentity.describeDiscordError(e400), /rejected/);
  });

  // --- guildPrefixes: startup load into memory ------------------------------
  await check('guildPrefixes: loads stored prefixes at startup, null otherwise', async () => {
    resetStore();
    await guildSettings.setGuildSettings('111', { prefix: '!' });
    await guildSettings.setGuildSettings('222', { prefix: '>>' });
    await guildSettings.setGuildSettings('333', { prefix: '' });
    const n = await guildPrefixes.loadGuildPrefixes();
    assert.strictEqual(n, 2, 'empty prefix counted as configured');
    assert.strictEqual(guildPrefixes.getPrefix('111'), '!');
    assert.strictEqual(guildPrefixes.getPrefix('222'), '>>');
    assert.strictEqual(guildPrefixes.getPrefix('333'), null);
    assert.strictEqual(guildPrefixes.getPrefix('999'), null);
    guildPrefixes.setPrefixCached('444', '?');
    assert.strictEqual(guildPrefixes.getPrefix('444'), '?');
    guildPrefixes.setPrefixCached('444', '');
    assert.strictEqual(guildPrefixes.getPrefix('444'), null);
  });

  await check('guildPrefixes: DB down loads zero and never throws', async () => {
    dbEnabled = false;
    try {
      const n = await guildPrefixes.loadGuildPrefixes();
      assert.strictEqual(n, 0);
      assert.strictEqual(guildPrefixes.getPrefix('111'), null);
    } finally { dbEnabled = true; }
  });

  // --- guildSettings: prefix column -----------------------------------------
  await check('guildSettings: prefix roundtrips, blank clears, columns stay in sync', async () => {
    resetStore();
    guildSettings.invalidate('111');
    assert.strictEqual((await guildSettings.getGuildSettings('111')).prefix, '', 'default is not empty string');
    await guildSettings.setGuildSettings('111', { prefix: '!' });
    assert.strictEqual((await guildSettings.getGuildSettings('111')).prefix, '!');
    await guildSettings.setGuildSettings('111', { prefix: '' });
    assert.strictEqual((await guildSettings.getGuildSettings('111')).prefix, '');
    assert.strictEqual(store.guildSettings.get('111').prefix, null, 'blank prefix not stored as NULL');
  });

  // --- dashboardIdentity: URL helpers + error mapping -----------------------
  await check('dashboardIdentity: guild/global/default avatar URLs', () => {
    assert.strictEqual(
      dashboardIdentity.cdnAvatarUrl('111', '222', 'abc123'),
      'https://cdn.discordapp.com/guilds/111/users/222/avatars/abc123.png');
    assert.strictEqual(
      dashboardIdentity.cdnAvatarUrl('111', '222', 'a_abc123'),
      'https://cdn.discordapp.com/guilds/111/users/222/avatars/a_abc123.gif');
    assert.strictEqual(
      dashboardIdentity.cdnUserAvatarUrl('222', 'def456'),
      'https://cdn.discordapp.com/avatars/222/def456.png');
    const expected = Number((BigInt('222') >> 22n) % 6n);
    assert.strictEqual(
      dashboardIdentity.defaultAvatarUrl('222'),
      `https://cdn.discordapp.com/embed/avatars/${expected}.png`);
  });

  await check('dashboardIdentity: describeRestError maps 403/429/400/404', () => {
    const e403 = new Error('Forbidden'); e403.response = { status: 403, data: {} };
    assert.match(dashboardIdentity.describeRestError(e403), /Change Nickname/);
    const e429 = new Error('Too Many'); e429.response = { status: 429, data: { retry_after: 42 } };
    assert.match(dashboardIdentity.describeRestError(e429), /42 seconds/);
    const e400 = new Error('Bad'); e400.response = { status: 400, data: { message: 'Invalid nick' } };
    assert.match(dashboardIdentity.describeRestError(e400), /Invalid nick/);
    const e404 = new Error('Not Found'); e404.response = { status: 404, data: {} };
    assert.match(dashboardIdentity.describeRestError(e404), /own member/);
  });

  await check('dashboardIdentity: validateNickname/validatePrefix trim, cap, clear', () => {
    assert.strictEqual(dashboardIdentity.validateNickname('  Hall Clerk  '), 'Hall Clerk');
    assert.strictEqual(dashboardIdentity.validateNickname(''), null);
    assert.strictEqual(dashboardIdentity.validateNickname('   '), null);
    assert.throws(() => dashboardIdentity.validateNickname('x'.repeat(33)), /32 characters/);
    assert.strictEqual(dashboardIdentity.validatePrefix('!'), '!');
    assert.strictEqual(dashboardIdentity.validatePrefix(''), null);
    assert.throws(() => dashboardIdentity.validatePrefix('x'.repeat(33)), /32 characters/);
  });

  // --- dashboardIdentity: getIdentityView -----------------------------------
  await check('getIdentityView: stored row + live guild avatar + prefix', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    await guildSettings.setGuildSettings('111', { prefix: '!' });
    const rest = mockRest({ member: restMember({ nick: 'Hall Clerk', guildAvatar: 'guildhash' }) });
    const view = await dashboardIdentity.getIdentityView('111', { rest });
    assert.strictEqual(view.nickname, 'Hall Clerk');
    assert.strictEqual(view.liveNickname, 'Hall Clerk');
    assert.strictEqual(view.hasCustomAvatar, true);
    assert.strictEqual(view.avatarUrl, 'https://cdn.discordapp.com/guilds/111/users/222/avatars/guildhash.png');
    assert.strictEqual(view.globalAvatarUrl, 'https://cdn.discordapp.com/avatars/222/globalhash.png');
    assert.strictEqual(view.username, 'Vikings Hall Clerk');
    assert.strictEqual(view.prefix, '!');
    assert.deepStrictEqual(rest.calls.get, ['/guilds/111/members/@me']);
  });

  await check('getIdentityView: no guild avatar falls back to the global one', async () => {
    resetStore();
    const rest = mockRest({ member: restMember({ nick: null, guildAvatar: null }) });
    const view = await dashboardIdentity.getIdentityView('111', { rest });
    assert.strictEqual(view.hasCustomAvatar, false);
    assert.strictEqual(view.avatarUrl, 'https://cdn.discordapp.com/avatars/222/globalhash.png');
    assert.strictEqual(view.nickname, null);
  });

  await check('getIdentityView: live fetch failing still shows the stored row + prefix', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    await guildSettings.setGuildSettings('111', { prefix: '!' });
    const rest = mockRest({ member: null, getError: new Error('Discord down') });
    const view = await dashboardIdentity.getIdentityView('111', { rest });
    assert.strictEqual(view.nickname, 'Hall Clerk');
    assert.strictEqual(view.prefix, '!');
    assert.strictEqual(view.liveNickname, null);
    assert.strictEqual(view.avatarUrl, null);
  });

  // --- dashboardIdentity: setIdentity ---------------------------------------
  await check('setIdentity: nickname applies live first, then saves', async () => {
    resetStore();
    const rest = mockRest({ member: restMember() });
    const out = await dashboardIdentity.setIdentity('111', { nickname: 'Hall Clerk' }, { rest });
    assert.deepStrictEqual(rest.calls.patch, [{ url: '/guilds/111/members/@me', data: { nick: 'Hall Clerk' } }]);
    assert.strictEqual(out.nickname, 'Hall Clerk');
    assert.deepStrictEqual(out.warnings, []);
    assert.strictEqual((await botIdentity.getIdentity('111')).nickname, 'Hall Clerk');
  });

  await check('setIdentity: blank nickname clears live + stored, keeps the avatar', async () => {
    resetStore();
    const gid = 'verify-1-16-8-si';
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const rest = mockRest({ member: restMember({ nick: 'Hall Clerk', guildAvatar: 'guildhash' }) });
    await dashboardIdentity.setIdentity(gid, { nickname: '' }, { rest });
    assert.deepStrictEqual(rest.calls.patch, [{ url: `/guilds/${gid}/members/@me`, data: { nick: null } }]);
    const row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, null);
    assert.strictEqual(row.avatar_path, botIdentity.storedAvatarPath(gid, 'png'));
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('setIdentity: nickname PATCH 403 throws plain words, row untouched', async () => {
    resetStore();
    const e403 = new Error('Forbidden'); e403.response = { status: 403, data: {} };
    const rest = mockRest({ member: restMember(), patchError: e403 });
    await assert.rejects(
      dashboardIdentity.setIdentity('111', { nickname: 'Hall Clerk' }, { rest }),
      /Change Nickname/);
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
  });

  await check('setIdentity: prefix-only save makes no Discord call', async () => {
    resetStore();
    const rest = mockRest({ member: restMember() });
    const out = await dashboardIdentity.setIdentity('111', { prefix: '!' }, { rest });
    assert.deepStrictEqual(rest.calls.patch, []);
    assert.strictEqual(out.prefix, '!');
    assert.strictEqual((await guildSettings.getGuildSettings('111')).prefix, '!');
  });

  await check('setIdentity: prefix too long throws, nickname still applied first', async () => {
    resetStore();
    const rest = mockRest({ member: restMember() });
    await assert.rejects(
      dashboardIdentity.setIdentity('111', { nickname: 'Hall Clerk', prefix: 'x'.repeat(33) }, { rest }),
      /32 characters/);
    // Nickname went through before the prefix validation failed.
    assert.strictEqual((await botIdentity.getIdentity('111')).nickname, 'Hall Clerk');
    assert.strictEqual((await guildSettings.getGuildSettings('111')).prefix, '');
  });

  await check('setIdentity: failed nickname save returns a warning, not a throw', async () => {
    resetStore();
    const rest = mockRest({ member: restMember() });
    failWrites = true;
    try {
      const out = await dashboardIdentity.setIdentity('111', { nickname: 'Hall Clerk' }, { rest });
      assert.strictEqual(out.warnings.length, 1);
      assert.match(out.warnings[0], /changed live but could not be saved/);
      assert.strictEqual(rest.calls.patch.length, 1, 'live change did not happen');
    } finally { failWrites = false; }
  });

  // --- dashboardIdentity: uploadAvatar / resetAvatar ------------------------
  await check('uploadAvatar: valid PNG applies live, saves file + row, returns the new URL', async () => {
    resetStore();
    const gid = 'verify-1-16-8-up';
    const rest = mockRest({ member: restMember({ guildAvatar: null }) });
    const out = await dashboardIdentity.uploadAvatar(gid, PNG, { rest });
    assert.strictEqual(rest.calls.patch.length, 1);
    assert.strictEqual(rest.calls.patch[0].url, `/guilds/${gid}/members/@me`);
    assert.match(rest.calls.patch[0].data.avatar, /^data:image\/png;base64,/);
    assert.strictEqual(out.warning, null);
    assert.strictEqual(out.avatarUrl, `https://cdn.discordapp.com/guilds/${gid}/users/222/avatars/newhash123.png`);
    assert.strictEqual((await botIdentity.getIdentity(gid)).avatar_path, botIdentity.storedAvatarPath(gid, 'png'));
    assert.ok(fs.existsSync(botIdentity.avatarFilePath(gid, 'png')));
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('uploadAvatar: non-image and oversize rejected before any Discord call', async () => {
    resetStore();
    const rest = mockRest({ member: restMember() });
    await assert.rejects(dashboardIdentity.uploadAvatar('111', TEXT, { rest }), /not a PNG, JPG, or GIF/);
    await assert.rejects(dashboardIdentity.uploadAvatar('111', Buffer.alloc(8 * 1024 * 1024 + 1), { rest }), /limit is 8 MB/);
    assert.deepStrictEqual(rest.calls.patch, []);
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
  });

  await check('uploadAvatar: PATCH 403 throws, nothing saved', async () => {
    resetStore();
    const gid = 'verify-1-16-8-up403';
    const e403 = new Error('Forbidden'); e403.response = { status: 403, data: {} };
    const rest = mockRest({ member: restMember(), patchError: e403 });
    await assert.rejects(dashboardIdentity.uploadAvatar(gid, PNG, { rest }), /Change Nickname/);
    assert.strictEqual(await botIdentity.getIdentity(gid), null);
    assert.ok(!fs.existsSync(botIdentity.avatarFilePath(gid, 'png')));
  });

  await check('uploadAvatar: failed save returns a warning, live change still happened', async () => {
    resetStore();
    const gid = 'verify-1-16-8-upw';
    const rest = mockRest({ member: restMember() });
    failWrites = true;
    try {
      const out = await dashboardIdentity.uploadAvatar(gid, PNG, { rest });
      assert.strictEqual(rest.calls.patch.length, 1);
      assert.match(out.warning, /changed live but could not be saved/);
    } finally { failWrites = false; }
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('resetAvatar: clears live + stored avatar, keeps nickname, returns global URL', async () => {
    resetStore();
    const gid = 'verify-1-16-8-rav';
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const rest = mockRest({ member: restMember({ guildAvatar: 'guildhash' }) });
    const out = await dashboardIdentity.resetAvatar(gid, { rest });
    assert.deepStrictEqual(rest.calls.patch, [{ url: `/guilds/${gid}/members/@me`, data: { avatar: null } }]);
    assert.strictEqual(out.avatarUrl, 'https://cdn.discordapp.com/avatars/222/globalhash.png');
    const row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, 'Hall Clerk');
    assert.strictEqual(row.avatar_path, null);
    assert.ok(!fs.existsSync(botIdentity.avatarFilePath(gid, 'png')));
  });

  await check('resetAvatar: no REST client throws instead of half-applying', async () => {
    await assert.rejects(dashboardIdentity.resetAvatar('111', {}), /unreachable/);
    await assert.rejects(dashboardIdentity.uploadAvatar('111', PNG, {}), /unreachable/);
  });

  // --- /botidentity command (real execute()) --------------------------------
  await check('command: set-name applies live, saves, replies with the new name', async () => {
    resetStore();
    const member = mockMember();
    const ix = mockInteraction({ sub: 'set-name', guild: mockGuild(member, '111'), name: 'Hall Clerk' });
    await command.execute(ix);
    assert.strictEqual(ix.replies.length, 1);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '✅ Bot nickname set');
    assert.match(ix.replies[0].embeds[0].data.description, /Hall Clerk/);
    assert.deepStrictEqual(member.calls.setNickname, ['Hall Clerk']);
    assert.strictEqual((await botIdentity.getIdentity('111')).nickname, 'Hall Clerk');
  });

  await check('command: set-name without Change Nickname errors plainly, saves nothing', async () => {
    resetStore();
    const member = mockMember({ canChange: false });
    const ix = mockInteraction({ sub: 'set-name', guild: mockGuild(member, '111'), name: 'Hall Clerk' });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '❌ Missing permission');
    assert.match(ix.replies[0].embeds[0].data.description, /Change Nickname/);
    assert.deepStrictEqual(member.calls.setNickname, [], 'setNickname attempted without the permission');
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
  });

  await check('command: set-name whose live change is rejected by Discord errors plainly', async () => {
    resetStore();
    const err = new Error('Missing Permissions'); err.code = 50013; err.status = 403;
    const member = mockMember({ failSetNickname: err });
    const ix = mockInteraction({ sub: 'set-name', guild: mockGuild(member, '111'), name: 'Hall Clerk' });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '❌ Could not change my nickname');
    assert.match(ix.replies[0].embeds[0].data.description, /Change Nickname/);
    assert.deepStrictEqual(member.calls.setNickname, ['Hall Clerk']);
    assert.strictEqual(await botIdentity.getIdentity('111'), null);
  });

  await check('command: set-name too long is rejected by the command itself', async () => {
    resetStore();
    const member = mockMember();
    const ix = mockInteraction({ sub: 'set-name', guild: mockGuild(member, '111'), name: 'x'.repeat(33) });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '❌ Name too long');
    assert.deepStrictEqual(member.calls.setNickname, []);
  });

  await check('command: set-name with a failed save says so instead of pretending it stuck', async () => {
    resetStore();
    const member = mockMember();
    const ix = mockInteraction({ sub: 'set-name', guild: mockGuild(member, '111'), name: 'Hall Clerk' });
    failWrites = true;
    try { await command.execute(ix); } finally { failWrites = false; }
    assert.match(ix.replies[0].embeds[0].data.title, /for now/);
    assert.match(ix.replies[0].embeds[0].data.description, /could not save/);
    assert.deepStrictEqual(member.calls.setNickname, ['Hall Clerk'], 'live change did not happen');
  });

  await check('command: DB down replies Database unavailable for every subcommand', async () => {
    resetStore();
    dbEnabled = false;
    try {
      for (const sub of ['set-name', 'show', 'reset']) {
        const member = mockMember();
        const ix = mockInteraction({ sub, guild: mockGuild(member, '111'), name: 'Hall Clerk' });
        await command.execute(ix);
        assert.strictEqual(ix.replies[0].embeds[0].data.title, '❌ Database unavailable');
      }
    } finally { dbEnabled = true; }
  });

  await check('command: show displays stored nickname + custom picture', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    await botIdentity.setAvatarPathRow('111', 'src/data/guild-avatars/111.png');
    const member = mockMember({ nickname: 'Hall Clerk', avatar: 'guildhash' });
    const ix = mockInteraction({ sub: 'show', guild: mockGuild(member, '111') });
    await command.execute(ix);
    const embed = ix.replies[0].embeds[0].data;
    assert.strictEqual(embed.title, 'Bot identity in this server');
    assert.match(embed.fields[0].value, /Hall Clerk/);
    assert.strictEqual(embed.fields[1].value, 'Custom picture for this server');
    assert.ok(embed.thumbnail.url.includes('cdn.example'), 'thumbnail missing');
  });

  await check('command: show with no identity points at the dashboard for the picture', async () => {
    resetStore();
    const member = mockMember();
    const ix = mockInteraction({ sub: 'show', guild: mockGuild(member, '111') });
    await command.execute(ix);
    const embed = ix.replies[0].embeds[0].data;
    assert.match(embed.description, /no custom bot identity/);
    assert.match(embed.description, /dashboard/);
    assert.match(embed.fields[0].value, /Default/);
    assert.strictEqual(embed.fields[1].value, 'Global avatar');
  });

  await check('command: reset clears the nickname only — avatar live, row, and file untouched', async () => {
    resetStore();
    const gid = 'verify-1-16-8-cmd-reset';
    const member = mockMember({ nickname: 'Hall Clerk', avatar: 'guildhash' });
    await botIdentity.setNicknameRow(gid, 'Hall Clerk');
    botIdentity.saveAvatarFile(gid, PNG, 'png');
    await botIdentity.setAvatarPathRow(gid, botIdentity.storedAvatarPath(gid, 'png'));
    const ix = mockInteraction({ sub: 'reset', guild: mockGuild(member, gid) });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '✅ Bot nickname reset');
    assert.match(ix.replies[0].embeds[0].data.description, /picture is unchanged/);
    assert.deepStrictEqual(member.calls.setNickname, [null]);
    assert.deepStrictEqual(member.calls.setAvatar, [], 'reset touched the avatar');
    assert.strictEqual(member.nickname, null);
    const row = await botIdentity.getIdentity(gid);
    assert.strictEqual(row.nickname, null);
    assert.strictEqual(row.avatar_path, botIdentity.storedAvatarPath(gid, 'png'));
    assert.ok(fs.existsSync(botIdentity.avatarFilePath(gid, 'png')), 'avatar file deleted by nickname reset');
    botIdentity.deleteAvatarFiles(gid);
  });

  await check('command: reset with nothing set says so and touches nothing', async () => {
    resetStore();
    const member = mockMember();
    const ix = mockInteraction({ sub: 'reset', guild: mockGuild(member, '111') });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, 'Nothing to reset');
    assert.deepStrictEqual(member.calls.setNickname, []);
    assert.deepStrictEqual(member.calls.setAvatar, []);
  });

  await check('command: reset whose live change fails reports it and never touches the avatar', async () => {
    resetStore();
    await botIdentity.setNicknameRow('111', 'Hall Clerk');
    const member = mockMember({ nickname: 'Hall Clerk', canChange: false });
    const ix = mockInteraction({ sub: 'reset', guild: mockGuild(member, '111') });
    await command.execute(ix);
    assert.strictEqual(ix.replies[0].embeds[0].data.title, '❌ Reset partly failed');
    assert.deepStrictEqual(member.calls.setAvatar, []);
  });

  await check('command: builder has exactly set-name/show/reset, Admin-only, no avatar subcommand', () => {
    const json = command.data.toJSON();
    assert.strictEqual(json.name, 'botidentity');
    assert.deepStrictEqual(json.options.map((o) => o.name), ['set-name', 'show', 'reset']);
    assert.strictEqual(String(json.default_member_permissions), String(PermissionFlagsBits.Administrator));
    assert.strictEqual(json.options.find((o) => o.name === 'show').description.length > 0, true);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'botidentity', 'botidentity.js'), 'utf8');
    assert.ok(!src.includes('set-avatar'), 'set-avatar still in the command');
    assert.ok(!src.includes('setAvatar('), 'command still calls setAvatar');
    assert.ok(!src.includes('downloadAvatar'), 'command still references the removed downloader');
    assert.ok(src.includes('resetNickname'), 'command does not use resetNickname');
  });

  // --- Deploy shape / docs / source checks ----------------------------------
  await check('deploy: 39 top-level, flat 270 / leaf 268, botidentity standalone', () => {
    const { buildConsolidated } = require('../src/handlers/consolidate');
    const { topLevel, flatCount } = buildConsolidated();
    assert.strictEqual(topLevel.length, 39, `top-level is ${topLevel.length}, expected 39`);
    assert.strictEqual(flatCount, 270, `flat is ${flatCount}, expected 270`);
    const names = topLevel.map((c) => c.data.name);
    assert.strictEqual(new Set(names).size, names.length, 'duplicate top-level names');
    const bot = topLevel.find((c) => c.data.name === 'botidentity');
    assert.ok(bot, 'botidentity missing from the consolidated list');
    assert.strictEqual(!!bot.isParent, false, 'botidentity was grouped under a parent');
    const chatInput = topLevel.filter((c) => (c.data.toJSON().type ?? 1) === 1).length;
    assert.ok(chatInput <= 100, `over Discord 100 top-level cap: ${chatInput}`);
  });

  await check('docs: scan finds botidentity in Bot Identity with the 3 subcommands', () => {
    const docs = require('../src/utils/docs');
    const entry = docs.scanCommands().find((c) => c.name === 'botidentity');
    assert.ok(entry, 'botidentity missing from the docs scan');
    assert.strictEqual(entry.category, 'Bot Identity');
    assert.deepStrictEqual(entry.subcommands, ['set-name', 'show', 'reset']);
    assert.strictEqual(entry.audience, 'Admin');
  });

  await check('docs: content.json bot-identity guide is dashboard-first, 5 steps, no avatar subcommand', () => {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'content.json'), 'utf8'));
    assert.strictEqual(content.guides.length, 65);
    const guide = content.guides.find((g) => g.id === 'bot-identity');
    assert.ok(guide, 'bot-identity guide missing');
    assert.strictEqual(guide.steps.length, 5);
    assert.ok(guide.steps.some((s) => s.includes('dashboard')), 'no step mentions the dashboard');
    assert.ok(guide.steps.some((s) => s.includes('prefix')), 'no step mentions the prefix');
    assert.ok(!guide.steps.some((s) => s.includes('set-avatar')), 'guide still documents an avatar subcommand');
  });

  await check('source: dashboard routes, view, JS, schema, and ready wiring all present', () => {
    const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
    assert.ok(dash.includes("'identity'"), 'identity missing from MODULES');
    assert.ok(dash.includes("app.post('/api/guilds/:id/identity'"), 'identity save route missing');
    assert.ok(dash.includes("app.post('/api/guilds/:id/identity/avatar'"), 'avatar upload route missing');
    assert.ok(dash.includes("app.post('/api/guilds/:id/identity/avatar/reset'"), 'avatar reset route missing');
    assert.ok(dash.includes("express.raw({ type: 'image/*'"), 'avatar route does not use express.raw');
    assert.ok(dash.includes('requireGuildAccess'), 'routes do not use requireGuildAccess');
    assert.ok(dash.includes('botRest'), 'botRest helper missing');
    assert.ok(dash.includes('identity,'), 'identity not passed to the settings render');
    const view = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs'), 'utf8');
    assert.ok(view.includes("['identity','🎭 Bot Identity']"), 'identity missing from the view nav');
    assert.ok(view.includes("module === 'identity'"), 'identity section missing from the view');
    assert.ok(view.includes('identity-avatar-form'), 'avatar form missing from the view');
    assert.ok(view.includes('identity-form'), 'nickname/prefix form missing from the view');
    assert.ok(view.includes('identity-avatar-reset'), 'avatar reset button missing from the view');
    const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'js', 'settings.js'), 'utf8');
    assert.ok(js.includes("'identity-form'"), 'identity-form handler missing from settings.js');
    assert.ok(js.includes("'identity-avatar-form'"), 'identity-avatar-form handler missing from settings.js');
    assert.ok(js.includes('#identity-avatar-reset'), 'avatar reset handler missing from settings.js');
    assert.ok(js.includes('#identity-avatar-file'), 'avatar file preview missing from settings.js');
    const gs = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'guildSettings.js'), 'utf8');
    assert.ok(gs.includes("'prefix',"), 'prefix missing from guildSettings COLUMNS');
    assert.ok(gs.includes('prefix: r.prefix'), 'prefix missing from the guildSettings read mapping');
    const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'database.js'), 'utf8');
    assert.ok(db.includes("['guild_settings', 'prefix', 'VARCHAR(32) NULL']"), 'prefix missing from MISSING_COLUMNS');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    assert.ok(schema.includes('prefix VARCHAR(32) NULL'), 'prefix missing from sql/schema.sql');
    const ready = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(ready.includes("require('../utils/guildPrefixes')"), 'ready.js does not load guildPrefixes');
    assert.ok(ready.includes('loadGuildPrefixes()'), 'ready.js does not call loadGuildPrefixes');
    const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('src/data/guild-avatars/'), 'avatar dir not gitignored');
    const deploy = fs.readFileSync(path.join(__dirname, '..', 'check-deploy.js'), 'utf8');
    assert.ok(deploy.includes('flatCount !== 270'), 'check-deploy flat count changed');
    assert.ok(deploy.includes('leafCount !== 268'), 'check-deploy leaf count changed');
  });

  await check('source: version 1.16.8 + changelog entry match the revised design', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.8');
    const log = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    assert.ok(log.includes('## [1.16.8] - 2026-11-20'), '1.16.8 entry missing from the changelog');
    const entry = log.slice(log.indexOf('## [1.16.8]'), log.indexOf('## [1.16.7]'));
    assert.ok(entry.includes('dashboard-only'), 'changelog does not say the avatar is dashboard-only');
    assert.ok(entry.includes('prefix'), 'changelog does not mention the prefix setting');
    assert.ok(entry.includes('dashboard restart'), 'changelog does not require a dashboard restart');
    assert.ok(!entry.includes('`set-avatar`'), 'changelog still documents an avatar subcommand');
  });

  // --- EJS render: the real settings.ejs identity tab -----------------------
  async function renderSettings(identity) {
    const locals = {
      user: { username: 'tester', id: '1', avatar: null },
      guild: { id: '111', name: 'Test Server', icon: null },
      module: 'identity',
      settings: { prefix: '!' },
      channels: [], roles: [],
      streamers: [], tickets: [], gameServers: [], applicationForms: [], pendingApplications: [],
      inviteLeaderboard: [], inviteStats: [], automodSettings: null, automodActions: [], suggestions: [],
      premiumSettings: null, shopItems: [], customCommands: [], faqs: [], scheduledMessages: [],
      countingSettings: null, birthdays: [], reactionRoleMappings: [], analyticsData: null, giveaways: [],
      aiUsage: null, aiConfigured: false, mcWidgets: [], voiceStats: [], voiceRate: null, colorRoles: [],
      modmailThreads: [], modmailBlocks: [], playlists: [], triviaSettings: null, triviaLeaderboard: [],
      roleMenus: [], milestoneSettings: null, milestoneNext: null, translateSettings: null, ticketPanels: [],
      inviteRoleRules: [], prestigeLeaderboard: [], countdowns: [], emojis: [], workJobs: [], recentRobs: [],
      tempBans: [], lotteryStatus: null, lotteryDraws: [], serverRules: null, identity,
      inviteUrl: 'https://example.invalid/invite',
      saved: false, isStaff: false, commandCatalog: [], scheduledEventsList: [], wordleLeaderboard: [],
      wordleToday: null, slowmodeSchedules: [], statusRoleRules: [], builtEmbeds: [], pastPolls: [],
      ticketRatingStats: null, inviteRewardList: [], inactiveMembers: null, threadOverrides: [],
      pendingConfessions: [], tempRoles: [], xpShopItems: [], commandToggles: [],
    };
    return ejs.renderFile(path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs'), locals);
  }

  await check('view: identity tab renders with avatar, nickname, prefix, and forms', async () => {
    const html = await renderSettings({
      nickname: 'Hall Clerk', liveNickname: 'Hall Clerk', hasCustomAvatar: true, hasStoredAvatar: true,
      avatarUrl: 'https://cdn.discordapp.com/guilds/111/users/222/avatars/guildhash.png',
      globalAvatarUrl: 'https://cdn.discordapp.com/avatars/222/globalhash.png',
      username: 'Vikings Hall Clerk', prefix: '!', updatedAt: '2026-11-20 23:00:00',
    });
    assert.ok(html.includes('Bot Identity'), 'tab heading missing');
    assert.ok(html.includes('https://cdn.discordapp.com/guilds/111/users/222/avatars/guildhash.png'), 'avatar preview missing');
    assert.ok(html.includes('Hall Clerk'), 'nickname missing');
    assert.ok(html.includes('value="!"'), 'prefix value missing');
    assert.ok(html.includes('id="identity-avatar-form"'), 'avatar form missing');
    assert.ok(html.includes('id="identity-form"'), 'nickname/prefix form missing');
    assert.ok(html.includes('id="identity-avatar-reset"'), 'avatar reset button missing');
    assert.ok(html.includes('custom for this server'), 'custom-avatar label missing');
    assert.ok(html.includes('/guilds/111/identity'), 'nav link to the tab missing');
  });

  await check('view: identity tab renders when the live fetch failed (identity null)', async () => {
    const html = await renderSettings(null);
    assert.ok(html.includes('Bot Identity'), 'tab heading missing on null identity');
    assert.ok(html.includes('Could not load the bot'), 'null-identity notice missing');
    assert.ok(html.includes('id="identity-form"'), 'forms missing on null identity');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:', failures.join(', '));
    process.exit(1);
  }
})();
