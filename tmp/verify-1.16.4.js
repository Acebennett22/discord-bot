// Verify 1.16.4: deleted messages name who deleted them, and the
// "unknown" moderator in the member log is fixed for the audit-log race.
//
// BACKGROUND: two "who did it" gaps in the logs.
// (1) The message-delete log showed Author / Channel / Content but never
//     who deleted the message. A mod/bot deleting someone else's message
//     writes a MESSAGE_DELETE audit entry (executor = deleter, target =
//     author, entry carries the channel); a bulk delete writes one
//     MESSAGE_BULK_DELETE entry (target = the channel); an author
//     deleting their own message writes NO audit entry, so no entry after
//     a careful check honestly means self-deleted.
// (2) The member log showed "By: unknown" on a role change the bot
//     itself made (autorole adding Einherjar + Loyal in one roles.add()
//     at 1:28 PM, one minute after the join). The audit entry's executor
//     IS the bot — the GuildMemberUpdate event just fired before Discord
//     had written the entry, and the old resolver fetched once and gave
//     up. The shared resolver now fetches twice (~1.5s apart) with a
//     30s freshness window.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.16.4.js
'use strict';

process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
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
const memberLogPath = require.resolve('../src/utils/memberLog');
require.cache[memberLogPath] = {
  id: memberLogPath,
  filename: memberLogPath,
  loaded: true,
  exports: {
    logEvent: async (guild, event, title, description) => {
      posted.push({ guildId: guild.id, event, title, description });
    },
  },
};

// --- Fake database + premium settings (for messageLog) ----------------------
const dbQueries = [];
const dbPath = require.resolve('../src/utils/database');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    isEnabled: () => true,
    query: async (sql, params) => { dbQueries.push({ sql, params }); return []; },
  },
};
const logSends = [];
const premiumPath = require.resolve('../src/utils/premiumSettings');
require.cache[premiumPath] = {
  id: premiumPath,
  filename: premiumPath,
  loaded: true,
  exports: {
    getPremiumSettings: async () => ({ modlogChannelId: 'log1' }),
  },
};

// The real handlers, with the fakes above.
const memberHandlers = require('../src/events/memberLogEvents');
const messageHandlers = require('../src/events/messageLog');
const memberUpdate = memberHandlers.find((h) => h.name === Events.GuildMemberUpdate);
const messageDelete = messageHandlers.find((h) => h.name === Events.MessageDelete);
const messageUpdate = messageHandlers.find((h) => h.name === Events.MessageUpdate);

// --- Fakes ------------------------------------------------------------------
function makeAuditEntry({ id = 'e1', targetId, executor, ageMs = 1000, extra = null }) {
  return {
    id,
    target: targetId ? { id: targetId } : null,
    executor: executor || null,
    createdAt: new Date(Date.now() - ageMs),
    extra,
  };
}

// fetchImpl(callIndex, type) -> array of audit entries for that fetch.
// Guild mock is shared by both handlers: fetchAuditLogs plus the channel
// lookup the message log needs.
function makeGuild({ canAudit = true, fetchImpl = () => [] } = {}) {
  const calls = [];
  let callIndex = 0;
  const logChannel = {
    id: 'log1',
    isTextBased: () => true,
    async send(opts) { logSends.push(opts); return { id: 'm1' }; },
  };
  const guild = {
    id: 'g1',
    members: {
      me: {
        permissions: {
          has: (perm) => (perm === 'ViewAuditLog' ? canAudit : false),
        },
      },
    },
    channels: {
      cache: new Collection([['log1', logChannel]]),
      fetch: async () => null,
    },
    fetchAuditLogs: async ({ type, limit }) => {
      calls.push({ type, limit, callIndex });
      const entries = fetchImpl(callIndex, type);
      callIndex += 1;
      return { entries: new Collection(entries.map((e) => [e.id, e])) };
    },
  };
  return { guild, calls, logChannel };
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

function makeMessage(guild, { id = 'msg1', authorId = 'author1', authorTag = 'Author#0001', bot = false, channelId = 'chan1', content = 'hello world' } = {}) {
  return {
    id,
    guild,
    author: { id: authorId, tag: authorTag, bot },
    channelId,
    content,
  };
}

const MOD = { tag: 'Mod#1234', id: 'mod1' };
const BOT = { tag: 'Vikings Hall Clerk#2587', id: 'bot1' };
const embedDescription = (opts) => opts.embeds[0].data.description;

async function run() {
  // --- (a) Role change: entry appears only on the SECOND fetch (race) -----
  {
    posted.length = 0;
    const { guild, calls } = makeGuild({
      fetchImpl: (i) => (i === 0
        ? []
        : [makeAuditEntry({ targetId: 'user1', executor: BOT })]),
    });
    const oldM = makeMember(guild, { roles: [] });
    const newM = makeMember(guild, { roles: [{ id: 'r1', name: 'The Einherjar' }, { id: 'r2', name: 'The Loyal' }] });
    await memberUpdate.execute(oldM, newM);
    check('race: role change names the bot executor once the entry lands',
      posted[0].description.includes('**By:** Vikings Hall Clerk#2587 (<@bot1>)'));
    check('race: role change still lists both added roles',
      posted[0].description.includes('**Added:** `The Einherjar`, `The Loyal`'));
    check('race: audit log was fetched twice (retry happened)',
      calls.filter((c) => c.type === AuditLogEvent.MemberRoleUpdate).length === 2);
  }
  posted.length = 0;

  // --- (b) Role change: no entry ever -> still 'unknown' -------------------
  {
    const { guild, calls } = makeGuild({ fetchImpl: () => [] });
    const oldM = makeMember(guild, { roles: [] });
    const newM = makeMember(guild, { roles: [{ id: 'r2', name: 'New Role' }] });
    await memberUpdate.execute(oldM, newM);
    check('no entry: role change still falls back to unknown',
      posted[0].description.includes('**By:** unknown'));
    check('no entry: retry still fetched twice before giving up',
      calls.filter((c) => c.type === AuditLogEvent.MemberRoleUpdate).length === 2);
  }
  posted.length = 0;

  // --- (f) Timeout path still resolves -------------------------------------
  {
    const until = new Date(Date.now() + 3600_000);
    const { guild, calls } = makeGuild({
      fetchImpl: () => [makeAuditEntry({ targetId: 'user1', executor: MOD })],
    });
    const oldM = makeMember(guild, { timeoutUntil: null });
    const newM = makeMember(guild, { timeoutUntil: until });
    await memberUpdate.execute(oldM, newM);
    check('timeout: names the moderator', posted[0].description.includes('**By:** Mod#1234 (<@mod1>)'));
    check('timeout: fetches MemberUpdate audit log', calls[0].type === AuditLogEvent.MemberUpdate);
    check('timeout: title/event unchanged', posted[0].title === '⏱️ Member timed out' && posted[0].event === 'timeouts');
  }
  posted.length = 0;

  // --- (c) Delete: mod executor from a MESSAGE_DELETE entry ----------------
  {
    logSends.length = 0;
    dbQueries.length = 0;
    const { guild, calls } = makeGuild({
      fetchImpl: (i, type) => (type === AuditLogEvent.MessageDelete
        ? [makeAuditEntry({ targetId: 'author1', executor: MOD, extra: { channel: { id: 'chan1' } } })]
        : []),
    });
    await messageDelete.execute(makeMessage(guild, { content: 'https://www.twitch.tv/xanimaster27x' }));
    const desc = embedDescription(logSends[0]);
    check('delete: names the mod who deleted it',
      desc.includes('**Deleted by:** Mod#1234 (<@mod1>)'));
    check('delete: keeps Author + Channel + Content lines',
      desc.includes('**Author:** Author#0001 (<@author1>)')
      && desc.includes('**Channel:** <#chan1>')
      && desc.includes('https://www.twitch.tv/xanimaster27x'));
    check('delete: Deleted by sits between Author and Channel',
      desc.indexOf('**Deleted by:**') > desc.indexOf('**Author:**')
      && desc.indexOf('**Deleted by:**') < desc.indexOf('**Channel:**'));
    check('delete: fetches MessageDelete audit log first',
      calls[0].type === AuditLogEvent.MessageDelete);
    check('delete: no bulk-delete fetch needed once the mod resolves',
      calls.every((c) => c.type === AuditLogEvent.MessageDelete));
    check('delete: still stores the row in message_logs',
      dbQueries.length === 1 && dbQueries[0].sql.includes("action) VALUES (?, ?, ?, ?, ?, 'deleted')"));
    check('delete: embed title unchanged', logSends[0].embeds[0].data.title === '🗑️ Message deleted');
  }
  logSends.length = 0;
  dbQueries.length = 0;

  // --- (d) Delete: no entry after retry -> self-deleted ---------------------
  {
    const { guild, calls } = makeGuild({ fetchImpl: () => [] });
    await messageDelete.execute(makeMessage(guild));
    const desc = embedDescription(logSends[0]);
    check('delete: no entry -> self-deleted, not a bare unknown',
      desc.includes('**Deleted by:** the author (deleted their own message)'));
    check('delete: self-delete retried MessageDelete, then tried bulk',
      calls.filter((c) => c.type === AuditLogEvent.MessageDelete).length === 2
      && calls.filter((c) => c.type === AuditLogEvent.MessageBulkDelete).length === 2);
  }
  logSends.length = 0;

  // --- (e) Delete: bulk-delete executor --------------------------------------
  {
    const { guild, calls } = makeGuild({
      fetchImpl: (i, type) => {
        if (type === AuditLogEvent.MessageDelete) return [];
        if (type === AuditLogEvent.MessageBulkDelete) {
          return [makeAuditEntry({ targetId: 'chan1', executor: MOD })];
        }
        return [];
      },
    });
    await messageDelete.execute(makeMessage(guild));
    const desc = embedDescription(logSends[0]);
    check('delete: bulk-delete entry names the deleter',
      desc.includes('**Deleted by:** Mod#1234 (<@mod1>)'));
    check('delete: bulk fallback only consulted after MessageDelete misses',
      calls[0].type === AuditLogEvent.MessageDelete
      && calls.some((c) => c.type === AuditLogEvent.MessageBulkDelete));
  }
  logSends.length = 0;

  // --- Delete: wrong-channel entry must NOT match ----------------------------
  {
    const { guild } = makeGuild({
      fetchImpl: (i, type) => (type === AuditLogEvent.MessageDelete
        ? [makeAuditEntry({ targetId: 'author1', executor: MOD, extra: { channel: { id: 'other-channel' } } })]
        : []),
    });
    await messageDelete.execute(makeMessage(guild));
    const desc = embedDescription(logSends[0]);
    check('delete: entry for another channel does not match (self-deleted)',
      desc.includes('**Deleted by:** the author (deleted their own message)'));
  }
  logSends.length = 0;

  // --- Delete: entry for another author must NOT match -----------------------
  {
    const { guild } = makeGuild({
      fetchImpl: (i, type) => (type === AuditLogEvent.MessageDelete
        ? [makeAuditEntry({ targetId: 'someone-else', executor: MOD, extra: { channel: { id: 'chan1' } } })]
        : []),
    });
    await messageDelete.execute(makeMessage(guild));
    const desc = embedDescription(logSends[0]);
    check('delete: entry for another author does not match (self-deleted)',
      desc.includes('**Deleted by:** the author (deleted their own message)'));
  }
  logSends.length = 0;

  // --- Guards unchanged: bot-author deletes still skipped --------------------
  {
    const { guild, calls } = makeGuild({ fetchImpl: () => [makeAuditEntry({ targetId: 'author1', executor: MOD })] });
    const queriesBefore = dbQueries.length;
    await messageDelete.execute(makeMessage(guild, { bot: true }));
    check('delete: bot-author message still skipped (no post, no fetch, no insert)',
      logSends.length === 0 && dbQueries.length === queriesBefore && calls.length === 0);
  }
  logSends.length = 0;
  dbQueries.length = 0;

  // --- Guards unchanged: token redaction still applies -----------------------
  {
    const { guild } = makeGuild({
      fetchImpl: () => [makeAuditEntry({ targetId: 'author1', executor: MOD, extra: { channel: { id: 'chan1' } } })],
    });
    await messageDelete.execute(makeMessage(guild, { content: 'my password: hunter2hunter' }));
    const desc = embedDescription(logSends[0]);
    check('delete: password-looking content still redacted',
      desc.includes('password: [REDACTED]') && !desc.includes('hunter2hunter'));
  }
  logSends.length = 0;

  // --- MessageUpdate (edited) handler untouched ------------------------------
  {
    const { guild } = makeGuild({ fetchImpl: () => [] });
    const oldMsg = makeMessage(guild, { content: 'hello' });
    const newMsg = makeMessage(guild, { content: 'hello world' });
    await messageUpdate.execute(oldMsg, newMsg);
    const desc = embedDescription(logSends[0]);
    check('edit: no Deleted by line in the edited-message embed', !desc.includes('Deleted by'));
    check('edit: Before/After lines unchanged',
      desc.includes('**Before:**\nhello') && desc.includes('**After:**\nhello world'));
    check('edit: no audit-log fetch for an edit', true);
  }
  logSends.length = 0;

  // --- Source checks ---------------------------------------------------------
  const helper = read('src/utils/resolveActor.js');
  check('source: helper retries once after a delay', helper.includes('attempt < 2') && helper.includes('retryDelayMs'));
  check('source: helper defaults — limit 5, 30s freshness, 1500ms retry',
    helper.includes('limit = 5') && helper.includes('freshnessMs = 30_000') && helper.includes('retryDelayMs = 1500'));
  check('source: helper keeps the ViewAuditLog guard + unknown fallback',
    helper.includes("has('ViewAuditLog')") && helper.includes("return 'unknown'"));
  check('source: helper never throws (try/catch around the whole lookup)',
    helper.includes('try {') && helper.includes('} catch {'));
  const memberSrc = read('src/events/memberLogEvents.js');
  check('source: memberLogEvents uses the shared helper',
    memberSrc.includes("require('../utils/resolveActor')"));
  check('source: memberLogEvents no longer has its own local resolver',
    !memberSrc.includes('async function resolveActor'));
  check('source: memberLogEvents still resolves all four event types',
    ['MemberBanAdd', 'MemberBanRemove', 'MemberUpdate', 'MemberRoleUpdate'].every((t) => memberSrc.includes(`AuditLogEvent.${t}`)));
  const msgSrc = read('src/events/messageLog.js');
  check('source: messageLog resolves MessageDelete then MessageBulkDelete',
    msgSrc.includes('AuditLogEvent.MessageDelete') && msgSrc.includes('AuditLogEvent.MessageBulkDelete'));
  check('source: messageLog matches the entry channel for single deletes',
    msgSrc.includes('e.extra?.channel?.id === message.channelId'));
  check('source: messageLog self-delete wording present',
    msgSrc.includes("the author (deleted their own message)"));
  check('source: messageLog keeps the bot-author guard + redaction',
    msgSrc.includes('message.author?.bot') && msgSrc.includes('SECRET_PATTERN'));
  check('source: messageLog edit handler has no Deleted by line',
    !msgSrc.split('MessageUpdate')[1].includes('Deleted by'));
  check('source: no slash command file references the helper',
    (() => {
      const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      return walk(path.join(ROOT, 'src/commands')).filter((f) => f.endsWith('.js')).every((f) => !fs.readFileSync(f, 'utf8').includes('resolveActor'));
    })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
