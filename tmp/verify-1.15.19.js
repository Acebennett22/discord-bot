// Verification for 1.15.19 (error-log secret scrubbing on message/stack).
// Usage: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.19.js
// No real MySQL in this sandbox, so the DB is a fake injected by stubbing
// src/utils/database in the require cache BEFORE errorLogger is loaded.
// All secret values used here are FAKE and injected into the config object
// at runtime (never real credentials). The log file is backed up and
// restored afterwards; the retry queue is left empty (fake DB "succeeds").
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'bot-errors.log');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// --- Fake DB: stub database BEFORE errorLogger loads it -----------------
const dbPath = require.resolve(path.join(ROOT, 'src', 'utils', 'database.js'));
const fakeDb = {
  isEnabled: () => true,
  query: async () => ({ affectedRows: 1 }),
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const config = require(path.join(ROOT, 'src', 'utils', 'config.js'));
const errorLogger = require(path.join(ROOT, 'src', 'utils', 'errorLogger.js'));

async function main() {
  // --- Back up the real log file ----------------------------------------
  const hadLog = fs.existsSync(LOG_FILE);
  const logBackup = hadLog ? fs.readFileSync(LOG_FILE) : null;

  // --- Inject FAKE secret values into the config object ------------------
  // Deliberately NOT Discord-token-shaped for the bot token, so the value
  // path (not the shape pattern) is what scrubs it.
  const fakes = {
    token: 'FAKE-TOKEN-VALUE-12345678',
    dashboardClientSecret: 'FAKE-DISCORD-CLIENT-SECRET-99',
    dashboardSessionSecret: 'FAKE-SESSION-SECRET-abcdef0123456789',
    dbPassword: 'FAKE-MYSQL-PASSWORD-xyz',
    twitchSecret: 'FAKE-TWITCH-CLIENT-SECRET-55',
    ytKey: 'FAKE-YOUTUBE-API-KEY-777',
    steamKey: 'FAKE-STEAM-API-KEY-888',
    aiKey: 'FAKE-OPENAI-API-KEY-999',
  };
  const saved = {
    token: config.token,
    dashboard: { ...(config.dashboard || {}) },
    database: { ...(config.database || {}) },
    streams: JSON.parse(JSON.stringify(config.streams || {})),
    steam: { ...(config.steam || {}) },
    ai: { ...(config.ai || {}) },
  };
  config.token = fakes.token;
  config.dashboard = { ...(config.dashboard || {}), clientSecret: fakes.dashboardClientSecret, sessionSecret: fakes.dashboardSessionSecret };
  config.database = { ...(config.database || {}), password: fakes.dbPassword };
  config.streams = {
    ...(config.streams || {}),
    twitch: { ...((config.streams || {}).twitch || {}), clientSecret: fakes.twitchSecret },
    youtube: { ...((config.streams || {}).youtube || {}), apiKey: fakes.ytKey },
  };
  config.steam = { ...(config.steam || {}), apiKey: fakes.steamKey };
  config.ai = { ...(config.ai || {}), apiKey: fakes.aiKey };

  try {
    // --- (a) configured secret VALUES are scrubbed from message/stack -----
    const entryA = await errorLogger.log({
      level: 'error', commandName: 'test',
      message: `login failed with ${fakes.token} and db said ${fakes.dbPassword}`,
      stack: `Error: bad key ${fakes.ytKey}\n    at check (${fakes.aiKey})`,
    });
    for (const [name, v] of Object.entries(fakes)) {
      check(`(a) configured value scrubbed from message/stack: ${name}`, !entryA.message.includes(v) && !entryA.stack.includes(v));
    }
    check('(a) scrub marker present in message', entryA.message.includes('[REDACTED]'));

    // Raw paste of a secret value with no key name at all.
    const entryA2 = await errorLogger.log({ level: 'error', message: `saw this: ${fakes.twitchSecret} in the wild` });
    check('(a) raw pasted secret value scrubbed', !entryA2.message.includes(fakes.twitchSecret));

    // --- (b) Authorization header + ?token= URL in a stack --------------
    const fakeBearer = 'FAKEBEARERTOKEN1234567890';
    const fakeQueryToken = 'FAKEQUERYTOKEN99';
    const entryB = await errorLogger.log({
      level: 'error',
      stack: `AxiosError: Request failed with status code 401\n    at foo (x.js:1:1)\n    headers: { Authorization: Bearer ${fakeBearer} }\n    url: https://example.com/cb?token=${fakeQueryToken}&next=home`,
    });
    check('(b) Bearer token scrubbed from stack', !entryB.stack.includes(fakeBearer) && entryB.stack.includes('Authorization: Bearer [REDACTED]'));
    check('(b) ?token= value scrubbed, rest of URL intact',
      !entryB.stack.includes(fakeQueryToken) && entryB.stack.includes('https://example.com/cb?token=[REDACTED]&next=home'));

    // Basic auth + JSON-style key/value + %3D-encoded param.
    const entryB2 = await errorLogger.log({
      level: 'error',
      message: `auth failed Authorization: Basic Zm9vOmJhcjEyMw== body {"access_token": "JSONTOKEN123"} redir ?client_secret%3DENCSECRET1`,
    });
    check('(b) Basic auth scrubbed', !entryB2.message.includes('Zm9vOmJhcjEyMw==') && entryB2.message.includes('Authorization: Basic [REDACTED]'));
    check('(b) JSON access_token scrubbed', !entryB2.message.includes('JSONTOKEN123') && entryB2.message.includes('"access_token": "[REDACTED]"'));
    check('(b) %3D-encoded client_secret scrubbed', !entryB2.message.includes('ENCSECRET1'));

    // --- (c) Discord bot-token SHAPE (not a configured value) ------------
    const shaped = 'A'.repeat(24) + '.' + 'B'.repeat(6) + '.' + 'C'.repeat(27);
    const entryC = await errorLogger.log({ level: 'error', message: `weird token in log: ${shaped} end` });
    check('(c) Discord-shaped token scrubbed', !entryC.message.includes(shaped) && entryC.message.includes('[REDACTED]'));

    // OpenAI-style key shape.
    const entryC2 = await errorLogger.log({ level: 'error', message: `key sk-proj-${'x'.repeat(30)} leaked` });
    check('(c) sk-proj- key shape scrubbed', !entryC2.message.includes('sk-proj-'));

    // --- (d) normal content survives unchanged ---------------------------
    const normal = 'Failed to play https://www.youtube.com/watch?v=0J2QdDbelmY for user 123456789012345678 (Ace#1234) in #general: invalid token type';
    const entryD = await errorLogger.log({ level: 'error', message: normal });
    check('(d) YouTube URL survives', entryD.message.includes('https://www.youtube.com/watch?v=0J2QdDbelmY'));
    check('(d) snowflake id + user tag survive', entryD.message.includes('123456789012345678') && entryD.message.includes('Ace#1234'));
    check('(d) channel name survives', entryD.message.includes('#general'));
    check('(d) "invalid token type" prose survives', entryD.message.includes('invalid token type'));
    check('(d) whole message unchanged', entryD.message === normal);
    const entryD2 = await errorLogger.log({ level: 'error', message: 'the token expired, please re-auth' });
    check('(d) "the token expired" prose survives', entryD2.message === 'the token expired, please re-auth');

    // --- (e) context redaction still works as before ---------------------
    const entryE = await errorLogger.log({
      level: 'error', message: 'ctx test',
      context: { token: 'should-go', nested: { apiKey: 'also-go', safe: 'keep-me' }, safeTop: 'hello' },
    });
    check('(e) context token field redacted', entryE.context.token === '[REDACTED]');
    check('(e) context nested apiKey redacted', entryE.context.nested.apiKey === '[REDACTED]');
    check('(e) context safe values kept', entryE.context.nested.safe === 'keep-me' && entryE.context.safeTop === 'hello');

    // --- (f) entry still written, caps intact ----------------------------
    const longMsg = 'x'.repeat(5000);
    const longStack = 'y'.repeat(9000);
    const entryF = await errorLogger.log({ level: 'error', message: longMsg, stack: longStack });
    check('(f) message capped at 4000', entryF.message.length === 4000);
    check('(f) stack capped at 8000', entryF.stack.length === 8000);
    check('(f) entry has created_at + level', typeof entryF.created_at === 'string' && entryF.level === 'error');
    // File write: the last line of the log file is this entry, scrubbed.
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    check('(f) file line matches returned entry', last.message === entryF.message && last.stack === entryF.stack);
    check('(f) retry queue empty (fake DB accepted the insert)', errorLogger.retryQueue.length === 0);

    // Short configured value (< 8 chars) must NOT trigger scrubbing.
    config.database.password = 'short';
    const entryG = await errorLogger.log({ level: 'error', message: 'a short word here' });
    check('(g) short configured value is not scrubbed', entryG.message === 'a short word here');
  } finally {
    // --- Restore config + log file ---------------------------------------
    config.token = saved.token;
    config.dashboard = saved.dashboard;
    config.database = saved.database;
    config.streams = saved.streams;
    config.steam = saved.steam;
    config.ai = saved.ai;
    if (hadLog) fs.writeFileSync(LOG_FILE, logBackup);
    else if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
