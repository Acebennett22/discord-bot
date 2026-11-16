// Verify 1.16.1: the member/moderation log names the moderator ("who did
// what"), like Discord's audit log.
//
// BACKGROUND: kicks already logged a `**By:**` line (resolved from the
// guild audit log in guildMemberRemove.js), but bans, unbans, timeouts,
// and role changes only named the target. 1.16.1 resolves the executor
// from the audit log for those four event types too, with the same
// pattern: View Audit Log permission, a fresh (<10s) entry for the
// target, 'unknown' fallback — and a failed lookup never breaks the
// log post.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.16.1.js
'use strict';

const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, AuditLogEvent, Events } = require('discord.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`  PASS ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}`); }
};

// --- Fake memberLog: capture logEvent calls ---------------------------------
const posted = [];
let throwLog = false;
const memberLogPath = require.resolve('../src/utils/memberLog');
require.cache[memberLogPath] = {
  id: memberLogPath,
  filename: memberLogPath,
  loaded: true,
  exports: {
    logEvent: async (guild, event, title, description) => {
      // The handlers destructured logEvent at require time, so the throwing
      // path is driven by this flag, not by reassigning the export.
      if (throwLog) throw new Error('log channel gone');
      posted.push({ guildId: guild.id, event, title, description });
    },
  },
};

// The real handlers, with the fake memberLog above.
const handlers = require('../src/events/memberLogEvents');
const byEvent = (name) => handlers.find((h) => h.name === name);
const banAdd = byEvent(Events.GuildBanAdd);
const banRemove = byEvent(Events.GuildBanRemove);
const memberUpdate = byEvent(Events.GuildMemberUpdate);

// --- Fakes ------------------------------------------------------------------
function makeAuditEntry({ id = 'e1', targetId, executor, ageMs = 1000 }) {
  return {
    id,
    target: targetId ? { id: targetId } : null,
    executor: executor || null,
    createdAt: new Date(Date.now() - ageMs),
  };
}

function makeGuild({ canAudit = true, auditEntries = [], fetchThrows = false } = {}) {
  const calls = [];
  const guild = {
    id: 'g1',
    members: {
      me: {
        permissions: {
          has: (perm) => (perm === 'ViewAuditLog' ? canAudit : false),
        },
      },
    },
    fetchAuditLogs: async ({ type, limit }) => {
      calls.push({ type, limit });
      if (fetchThrows) throw new Error('discord down');
      return { entries: new Collection(auditEntries.map((e) => [e.id, e])) };
    },
  };
  return { guild, calls };
}

function makeBan(guild, { userId = 'user1', tag = 'Bad#0001', reason = 'spam' } = {}) {
  return { guild, user: { id: userId, tag }, reason };
}

function makeMember(guild, { id = 'user1', tag = 'User#0001', bot = false, roles = [], timeoutUntil = null } = {}) {
  return {
    id,
    user: { id, tag, bot },
    guild,
    communicationDisabledUntil: timeoutUntil,
    roles: { cache: new Collection(roles.map((r) => [r.id, r])) },
  };
}

const MOD = { tag: 'Mod#1234', id: 'mod1' };

async function run() {
  // --- GuildBanAdd ---------------------------------------------------------
  {
    const { guild, calls } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    await banAdd.execute(makeBan(guild));
    check('ban add: names the moderator', posted[0].description.includes('**By:** Mod#1234 (<@mod1>)'));
    check('ban add: keeps User + Reason lines',
      posted[0].description.includes('**User:** Bad#0001 (<@user1>)')
      && posted[0].description.includes('**Reason:** spam'));
    check('ban add: By line sits between User and Reason',
      posted[0].description.indexOf('**By:**') > posted[0].description.indexOf('**User:**')
      && posted[0].description.indexOf('**By:**') < posted[0].description.indexOf('**Reason:**'));
    check('ban add: fetches MemberBanAdd audit log', calls[0].type === AuditLogEvent.MemberBanAdd);
    check('ban add: title/event unchanged', posted[0].title === '🔨 Member banned' && posted[0].event === 'bans');
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'someone-else', executor: MOD })],
    });
    await banAdd.execute(makeBan(guild));
    check('ban add: entry for another target -> unknown', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD, ageMs: 11_000 })],
    });
    await banAdd.execute(makeBan(guild));
    check('ban add: stale entry (>10s) -> unknown', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;
  {
    const { guild, calls } = makeGuild({
      canAudit: false,
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    await banAdd.execute(makeBan(guild));
    check('ban add: no View Audit Log -> unknown, no fetch', posted[0].description.includes('**By:** unknown') && calls.length === 0);
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({ fetchThrows: true });
    await assert.doesNotReject(() => banAdd.execute(makeBan(guild)));
    check('ban add: audit fetch throwing -> unknown, execute still resolves', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({ auditEntries: [makeAuditEntry({ targetId: 'user1', executor: null })] });
    await banAdd.execute(makeBan(guild, { reason: null }));
    check('ban add: entry with no executor -> unknown, reason fallback kept',
      posted[0].description.includes('**By:** unknown') && posted[0].description.includes('**Reason:** no reason given'));
  }
  posted.length = 0;

  // --- GuildBanRemove ------------------------------------------------------
  {
    const { guild, calls } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    await banRemove.execute(makeBan(guild));
    check('ban remove: names the moderator', posted[0].description.includes('**By:** Mod#1234 (<@mod1>)'));
    check('ban remove: keeps User line', posted[0].description.includes('**User:** Bad#0001 (<@user1>)'));
    check('ban remove: fetches MemberBanRemove audit log', calls[0].type === AuditLogEvent.MemberBanRemove);
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({ auditEntries: [] });
    await banRemove.execute(makeBan(guild));
    check('ban remove: no entry -> unknown', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;

  // --- Timeout (GuildMemberUpdate) -----------------------------------------
  const until = new Date(Date.now() + 3600_000);
  {
    const { guild, calls } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    const oldM = makeMember(guild, { timeoutUntil: null });
    const newM = makeMember(guild, { timeoutUntil: until });
    await memberUpdate.execute(oldM, newM);
    check('timeout: names the moderator', posted[0].description.includes('**By:** Mod#1234 (<@mod1>)'));
    check('timeout: keeps User + Until lines',
      posted[0].description.includes('**User:** User#0001 (<@user1>)')
      && posted[0].description.includes(`**Until:** <t:${Math.floor(until.getTime() / 1000)}:F>`));
    check('timeout: fetches MemberUpdate audit log', calls[0].type === AuditLogEvent.MemberUpdate);
    check('timeout: title/event unchanged', posted[0].title === '⏱️ Member timed out' && posted[0].event === 'timeouts');
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({ auditEntries: [] });
    const oldM = makeMember(guild, { timeoutUntil: null });
    const newM = makeMember(guild, { timeoutUntil: until });
    await memberUpdate.execute(oldM, newM);
    check('timeout: no entry -> unknown', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;
  {
    // Timeout ending is not a new timeout: nothing logs.
    const { guild } = makeGuild({ auditEntries: [] });
    const oldM = makeMember(guild, { timeoutUntil: until });
    const newM = makeMember(guild, { timeoutUntil: null });
    await memberUpdate.execute(oldM, newM);
    check('timeout ending: no log post', posted.length === 0);
  }
  posted.length = 0;

  // --- Role changes (GuildMemberUpdate) ------------------------------------
  {
    const { guild, calls } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    const oldM = makeMember(guild, { roles: [{ id: 'r1', name: 'Old Role' }] });
    const newM = makeMember(guild, { roles: [{ id: 'r1', name: 'Old Role' }, { id: 'r2', name: 'New Role' }] });
    await memberUpdate.execute(oldM, newM);
    check('role add: names the moderator', posted[0].description.includes('**By:** Mod#1234 (<@mod1>)'));
    check('role add: keeps Added line', posted[0].description.includes('**Added:** `New Role`'));
    check('role add: fetches MemberRoleUpdate audit log', calls[0].type === AuditLogEvent.MemberRoleUpdate);
    check('role add: title/event unchanged', posted[0].title === '🎭 Roles changed' && posted[0].event === 'roleChanges');
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    const oldM = makeMember(guild, { roles: [{ id: 'r1', name: 'Old Role' }, { id: 'r2', name: 'New Role' }] });
    const newM = makeMember(guild, { roles: [{ id: 'r1', name: 'Old Role' }] });
    await memberUpdate.execute(oldM, newM);
    check('role remove: names the moderator + Removed line',
      posted[0].description.includes('**By:** Mod#1234 (<@mod1>)')
      && posted[0].description.includes('**Removed:** `New Role`'));
  }
  posted.length = 0;
  {
    const { guild } = makeGuild({ auditEntries: [] });
    const oldM = makeMember(guild, { roles: [] });
    const newM = makeMember(guild, { roles: [{ id: 'r2', name: 'New Role' }] });
    await memberUpdate.execute(oldM, newM);
    check('role change: no entry -> unknown', posted[0].description.includes('**By:** unknown'));
  }
  posted.length = 0;
  {
    // Bot member updates are skipped entirely (unchanged behavior).
    const { guild } = makeGuild({ auditEntries: [] });
    const oldM = makeMember(guild, { bot: true, roles: [] });
    const newM = makeMember(guild, { bot: true, roles: [{ id: 'r2', name: 'New Role' }], timeoutUntil: until });
    await memberUpdate.execute(oldM, newM);
    check('bot member update: no log post', posted.length === 0);
  }
  posted.length = 0;
  {
    // Timeout AND role change in one update: two posts, each with By.
    const { guild, calls } = makeGuild({
      auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    const oldM = makeMember(guild, { timeoutUntil: null, roles: [] });
    const newM = makeMember(guild, { timeoutUntil: until, roles: [{ id: 'r2', name: 'New Role' }] });
    await memberUpdate.execute(oldM, newM);
    check('timeout + role change: two posts, both name the moderator',
      posted.length === 2
      && posted.every((p) => p.description.includes('**By:** Mod#1234 (<@mod1>)')));
    check('timeout + role change: one MemberUpdate fetch, one MemberRoleUpdate fetch',
      calls.length === 2
      && calls[0].type === AuditLogEvent.MemberUpdate
      && calls[1].type === AuditLogEvent.MemberRoleUpdate);
  }
  posted.length = 0;
  {
    // A throwing logEvent never breaks the handler (unchanged .catch).
    throwLog = true;
    const { guild } = makeGuild({ auditEntries: [makeAuditEntry({ targetId: 'user1', executor: MOD })] });
    await assert.doesNotReject(() => banAdd.execute(makeBan(guild)));
    check('throwing logEvent: execute still resolves', true);
    throwLog = false;
  }

  // --- Source checks --------------------------------------------------------
  const src = read('src/events/memberLogEvents.js');
  check('source: AuditLogEvent imported', src.includes('AuditLogEvent'));
  check('source: resolveActor helper present', src.includes('async function resolveActor'));
  check('source: 10s freshness window', src.includes('10_000'));
  check('source: ViewAuditLog permission check', src.includes("has('ViewAuditLog')"));
  check('source: unknown fallback', src.includes("'unknown'"));
  const diff = execSync('git diff --stat', { cwd: ROOT, encoding: 'utf8' });
  check('scope: only memberLogEvents.js changed in src/',
    diff.split('\n').filter((l) => l.includes('src/')).every((l) => l.includes('memberLogEvents.js'))
    && diff.includes('memberLogEvents.js'));
  const kickSrc = read('src/events/guildMemberRemove.js');
  check('scope: kick handling untouched (no By change there)',
    kickSrc.includes('**By:** ${kick.executor') && !diff.includes('guildMemberRemove.js'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
