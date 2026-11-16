// Verify 1.15.25: FAQ/autoresponder/custom-command double-reply race fix.
//
// The bug: three MessageCreate listeners (customCommands, faqResponder,
// messageCreate -> autoresponders.handleMessage) each checked the shared
// isHandled() marker BEFORE their async DB lookup and only called
// markHandled() AFTER a match. discord.js invokes all three listeners on
// the same event and each runs synchronously only until its first await,
// so all three passed the check before any of them marked the message —
// a message matching two systems got TWO replies. The fix: tryClaim()
// in messageHandled.js (check + add are adjacent synchronous statements,
// atomic on Node's single thread), claimed immediately before replying,
// plus an isHandled() check right before the AI-chat reply in
// messageCreate.js.
//
// This script proves it both ways: it runs the OLD check-then-mark logic
// against the same mocks (reproduces the double reply) and then runs the
// REAL handlers (exactly one reply). No live Discord or MySQL required.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const tick = () => new Promise((r) => setTimeout(r, 0));

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// === Mock state (per-scenario) ============================================
let mockFaqHit = null;      // { id, response } or null
let mockCustomHit = null;   // { trigger_word, response } or null
let mockRules = [];         // autoresponder rows
let mockSettings = null;    // guild settings for the AI block
let aiCalls = 0;

function stub(relPath, exportsObj) {
  const resolved = require.resolve(path.join(ROOT, relPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('src/utils/faq', {
  getFaqs: async () => { await tick(); return mockFaqHit ? [{ id: mockFaqHit.id, question: 'q', response: mockFaqHit.response }] : []; },
  matchFaq: () => mockFaqHit,
  incrementFaqUse: async () => {},
});
stub('src/utils/customCommands', {
  findCustomCommand: async () => { await tick(); return mockCustomHit; },
  incrementUse: async () => {},
  sanitizeResponse: (s) => s,
});
stub('src/utils/database', {
  isEnabled: () => true,
  query: async (sql) => {
    await tick();
    if (/FROM autoresponders/.test(sql)) return mockRules;
    return [];
  },
});
stub('src/utils/embeds', { infoEmbed: (title, desc) => ({ title, description: desc }) });
stub('src/utils/leveling', { awardXp: async () => {} });
stub('src/utils/automod', { handleMessage: async () => { await tick(); return { deleted: false }; } });
stub('src/utils/sticky', { handleMessage: async () => {} });
stub('src/utils/analytics', { recordMessage: () => {} });
stub('src/utils/guildSettings', { getGuildSettings: async () => { await tick(); return mockSettings; } });
stub('src/utils/ai', {
  isAiConfigured: () => true,
  askAI: async () => { aiCalls++; await tick(); return { ok: true, reply: 'AI says hi' }; },
});
stub('src/utils/translate', { handleTranslateMessage: async () => {} });

// Real handlers under test (they require the stubs above + real messageHandled).
const { isHandled, markHandled, tryClaim } = require(path.join(ROOT, 'src', 'utils', 'messageHandled'));
const faqResponder = require(path.join(ROOT, 'src', 'events', 'faqResponder'));
const customCommands = require(path.join(ROOT, 'src', 'events', 'customCommands'));
const messageCreate = require(path.join(ROOT, 'src', 'events', 'messageCreate'));

function makeMessage(id, content, channelId = 'c-general') {
  const replies = [];
  const message = {
    id,
    content,
    channelId,
    guildId: 'g1',
    guild: { id: 'g1', name: 'Test Guild' },
    author: { id: 'u1', bot: false },
    reply: async (opts) => { replies.push(opts); return {}; },
  };
  return { message, replies };
}

// Invoke all three listeners the way discord.js does: concurrently, same event.
async function runAll(message) {
  await Promise.allSettled([
    customCommands.execute(message),
    faqResponder.execute(message),
    messageCreate.execute(message),
  ]);
}

// === Old check-then-mark logic (pre-fix), same mocks, same message ========
async function oldCustomExecute(message) {
  const hit = await (async () => { await tick(); return mockCustomHit; })();
  if (!hit) return;
  markHandled(message.id);
  await message.reply({ content: hit.response });
}
async function oldFaqExecute(message) {
  if (isHandled(message.id)) return;
  await tick();
  if (!mockFaqHit) return;
  markHandled(message.id);
  await message.reply({ embeds: [{ title: 'FAQ' }] });
}
async function oldAutoExecute(message) {
  if (isHandled(message.id)) return false;
  await tick();
  const hit = mockRules.find((r) => r.enabled && message.content.toLowerCase().includes(String(r.trigger).toLowerCase()));
  if (!hit) return false;
  markHandled(message.id);
  await message.reply({ content: hit.response });
  return true;
}

(async () => {
  // === tryClaim unit checks =================================================
  check('tryClaim: first claim wins', tryClaim('unit-1') === true);
  check('tryClaim: second claim on same id loses', tryClaim('unit-1') === false);
  check('tryClaim: claimed id reads handled', isHandled('unit-1') === true);
  check('tryClaim: different id still claimable', tryClaim('unit-2') === true);
  check('isHandled: unclaimed id is not handled', isHandled('unit-nope') === false);

  // === Reproduction: OLD logic double-replies ===============================
  mockFaqHit = { id: 1, response: 'faq answer' };
  mockCustomHit = { trigger_word: 'hello', response: 'custom answer' };
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  mockSettings = null;
  {
    const { message, replies } = makeMessage('old-1', 'hello there');
    await Promise.allSettled([oldCustomExecute(message), oldFaqExecute(message), oldAutoExecute(message)]);
    check('OLD logic reproduces the bug: message matching 3 systems gets 3 replies', replies.length === 3, `got ${replies.length}`);
  }
  {
    const { message, replies } = makeMessage('old-2', 'hello there');
    mockCustomHit = null;
    await Promise.allSettled([oldFaqExecute(message), oldAutoExecute(message)]);
    check('OLD logic reproduces the bug: FAQ + autoresponder gets 2 replies', replies.length === 2, `got ${replies.length}`);
  }

  // === Fixed handlers =======================================================
  // (a) FAQ + autoresponder match -> exactly one reply
  mockFaqHit = { id: 1, response: 'faq answer' };
  mockCustomHit = null;
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  mockSettings = null;
  {
    const { message, replies } = makeMessage('new-a', 'hello there');
    await runAll(message);
    check('(a) FAQ + autoresponder match: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (b) custom command + FAQ match -> exactly one reply
  mockFaqHit = { id: 1, response: 'faq answer' };
  mockCustomHit = { trigger_word: 'hello', response: 'custom answer' };
  mockRules = [];
  {
    const { message, replies } = makeMessage('new-b', 'hello');
    await runAll(message);
    check('(b) custom command + FAQ match: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (j) all three match -> exactly one reply
  mockFaqHit = { id: 1, response: 'faq answer' };
  mockCustomHit = { trigger_word: 'hello', response: 'custom answer' };
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  {
    const { message, replies } = makeMessage('new-j', 'hello there');
    await runAll(message);
    check('(j) all three systems match: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (c) only FAQ -> exactly one reply
  mockFaqHit = { id: 1, response: 'faq answer' };
  mockCustomHit = null;
  mockRules = [];
  {
    const { message, replies } = makeMessage('new-c', 'some question');
    await runAll(message);
    check('(c) only FAQ matches: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (d) only autoresponder -> exactly one reply
  mockFaqHit = null;
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  {
    const { message, replies } = makeMessage('new-d', 'hello there');
    await runAll(message);
    check('(d) only autoresponder matches: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (h) custom + autoresponder match -> exactly one reply
  mockCustomHit = { trigger_word: 'hello', response: 'custom answer' };
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  {
    const { message, replies } = makeMessage('new-h', 'hello there');
    await runAll(message);
    check('(h) custom command + autoresponder match: exactly 1 reply', replies.length === 1, `got ${replies.length}`);
  }
  // (e) nothing matches -> zero replies
  mockFaqHit = null;
  mockCustomHit = null;
  mockRules = [];
  {
    const { message, replies } = makeMessage('new-e', 'nothing matches this');
    await runAll(message);
    check('(e) nothing matches: 0 replies', replies.length === 0, `got ${replies.length}`);
  }
  // (f) AI channel + autoresponder match -> auto-reply only, NO AI reply
  mockRules = [{ id: 1, trigger: 'hello', match_type: 'contains', enabled: true, response: 'auto answer' }];
  mockSettings = { aiEnabled: true, aiChannelId: 'c-ai' };
  aiCalls = 0;
  {
    const { message, replies } = makeMessage('new-f', 'hello there', 'c-ai');
    await runAll(message);
    check('(f) AI channel + autoresponder match: exactly 1 reply (the auto-reply)', replies.length === 1, `got ${replies.length}`);
    check('(f) AI channel + autoresponder match: AI never called', aiCalls === 0, `aiCalls=${aiCalls}`);
  }
  // (g) AI channel + no auto match -> AI replies once, no auto-reply
  mockRules = [];
  aiCalls = 0;
  {
    const { message, replies } = makeMessage('new-g', 'what is 2+2', 'c-ai');
    await runAll(message);
    check('(g) AI channel + no auto match: exactly 1 reply (the AI answer)', replies.length === 1, `got ${replies.length}`);
    check('(g) AI channel + no auto match: AI called once', aiCalls === 1, `aiCalls=${aiCalls}`);
  }

  // === Source checks: the fix is where the task says it is =================
  const mhSrc = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'messageHandled.js'), 'utf8');
  const faqSrc = fs.readFileSync(path.join(ROOT, 'src', 'events', 'faqResponder.js'), 'utf8');
  const ccSrc = fs.readFileSync(path.join(ROOT, 'src', 'events', 'customCommands.js'), 'utf8');
  const arSrc = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'autoresponders.js'), 'utf8');
  const mcSrc = fs.readFileSync(path.join(ROOT, 'src', 'events', 'messageCreate.js'), 'utf8');
  check('messageHandled exports tryClaim', /module\.exports = \{[^}]*tryClaim[^}]*\}/.test(mhSrc));
  check('tryClaim check+add are adjacent with no await between', /if \(handled\.has\(messageId\)\) return false;\s*\n\s*handled\.add\(messageId\);/.test(mhSrc));
  check('faqResponder claims immediately before reply', /if \(!tryClaim\(message\.id\)\) return;[^]*?await message\.reply/.test(faqSrc));
  check('faqResponder keeps the early isHandled fast-path', /if \(isHandled\(message\.id\)\) return;/.test(faqSrc));
  check('faqResponder no longer calls markHandled', !/markHandled/.test(faqSrc));
  check('customCommands claims immediately before reply', /if \(!tryClaim\(message\.id\)\) return;[^]*?await message\.reply/.test(ccSrc));
  check('customCommands no longer calls markHandled', !/markHandled/.test(ccSrc));
  check('autoresponders claims immediately before reply', /if \(!tryClaim\(message\.id\)\) return false;[^]*?await message\.reply/.test(arSrc));
  check('autoresponders keeps the early isHandled check', /if \(isHandled\(message\.id\)\) return false;/.test(arSrc));
  check('autoresponders no longer calls markHandled', !/markHandled/.test(arSrc));
  check('messageCreate skips AI when the message is already handled', /!isHandled\(message\.id\)/.test(mcSrc));
  check('messageCreate AI check sits in the AI condition (after autoresponder ran)', /settings\?\.aiEnabled[\s\S]*?!isHandled\(message\.id\)/.test(mcSrc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
