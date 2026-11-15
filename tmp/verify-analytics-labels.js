// Verification for 1.15.3: resolver + route enrichment mirror + EJS render
// of the analytics section with sample enriched rows. Run from the repo root:
//   node tmp/verify-analytics-labels.js
// (Same ALLOW_PLACEHOLDER_CONFIG the dashboard sets before requiring config.)
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { resolveUserLabels } = require('../src/utils/userLabels');

(async () => {
  // --- Resolver: mock fetch (IDs from the live analytics page) ---------------
  let calls = 0;
  const mockFetch = async (id) => {
    calls++;
    if (id === '633846213002919966') return { id, username: 'acebennett22', global_name: 'Ace' };
    if (id === '1204261888549064738') return { id, username: 'someuser', global_name: null };
    if (id === '999999999999999999') throw new Error('404 Not Found'); // left Discord
    return null;
  };

  // Same ID in both leaderboards + an unresolvable one: each real ID fetched once.
  const labels = await resolveUserLabels(
    ['633846213002919966', '1204261888549064738', '633846213002919966', '999999999999999999'],
    mockFetch,
  );
  assert.strictEqual(calls, 3, `expected 3 fetches (deduped), got ${calls}`);
  assert.strictEqual(labels.get('633846213002919966'), 'Ace (633846213002919966)');
  assert.strictEqual(labels.get('1204261888549064738'), 'someuser (1204261888549064738)');
  assert.strictEqual(labels.get('999999999999999999'), '999999999999999999 (unknown user)');
  console.log('resolver: OK — dedupe across both lists, display-name preference, unknown-user fallback');

  // --- Route enrichment (mirrors the analytics block in dashboard.js) -------
  const analyticsData = {
    daily: [{ date: '2026-11-15', joins: 2, leaves: 0, member_count: 42, messages_count: 120 }],
    topXp: [
      { user_id: '633846213002919966', xp: 1500, level: 5 },
      { user_id: '999999999999999999', xp: 200, level: 1 },
    ],
    topChannels: [{ channel_id: '111222333444555666', uses: 4 }],
    topCommandUsers: [
      { user_id: '633846213002919966', commands_used: 6 },
      { user_id: '1204261888549064738', commands_used: 1 },
    ],
    activeBoost: null,
  };
  // Exact enrichment from the route: one resolve call for both lists.
  const routeLabels = await resolveUserLabels([
    ...analyticsData.topXp.map((u) => u.user_id),
    ...analyticsData.topCommandUsers.map((u) => u.user_id),
  ], mockFetch);
  for (const u of [...analyticsData.topXp, ...analyticsData.topCommandUsers]) {
    u.user_label = routeLabels.get(String(u.user_id));
  }
  assert.strictEqual(analyticsData.topXp[0].user_label, 'Ace (633846213002919966)');
  assert.strictEqual(analyticsData.topXp[1].user_label, '999999999999999999 (unknown user)');
  assert.strictEqual(analyticsData.topCommandUsers[0].user_label, 'Ace (633846213002919966)');
  assert.strictEqual(analyticsData.topCommandUsers[1].user_label, 'someuser (1204261888549064738)');
  console.log('route enrichment: OK — both leaderboards labelled, shared ID resolved once');

  // --- Template render -------------------------------------------------------
  const locals = {
    user: { username: 'Ace' },
    guild: { id: '1571439343976058970', name: 'Test Server', icon: null },
    module: 'analytics',
    settings: {},
    channels: [{ id: '111222333444555666', name: 'the-mead-hall', type: 0 }],
    roles: [], streamers: [], tickets: [], gameServers: [], applicationForms: [],
    pendingApplications: [], inviteLeaderboard: [], inviteStats: null,
    automodSettings: null, automodActions: [], suggestions: [], premiumSettings: null,
    shopItems: [], customCommands: [], faqs: [], scheduledMessages: [],
    countingSettings: null, birthdays: [], reactionRoleMappings: [], analyticsData,
    giveaways: [], aiUsage: null, aiConfigured: false, mcWidgets: [], voiceStats: null,
    voiceRate: null, colorRoles: [], modmailThreads: [], modmailBlocks: [],
    playlists: [], triviaSettings: null, triviaLeaderboard: [], roleMenus: [],
    milestoneSettings: null, milestoneNext: null, translateSettings: null,
    ticketPanels: [], inviteRoleRules: [], prestigeLeaderboard: [],
    countdowns: [], emojis: [], workJobs: [], recentRobs: [], tempBans: [],
    lotteryStatus: null, lotteryDraws: [], serverRules: [], inviteUrl: 'https://example.invalid/invite',
    saved: false, isStaff: true,
    scheduledEventsList: [], wordleLeaderboard: [], wordleToday: null,
    slowmodeSchedules: [], statusRoleRules: [], builtEmbeds: [], pastPolls: [],
    ticketRatingStats: null, inviteRewardList: [], inactiveMembers: null,
    commandToggles: [],
  };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs'), locals, { async: true });
  assert.ok(html.includes('Ace (633846213002919966)'), 'top-XP label missing from render');
  assert.ok(html.includes('someuser (1204261888549064738)'), 'top-commands label missing from render');
  assert.ok(html.includes('999999999999999999 (unknown user)'), 'unknown-user fallback missing from render');
  assert.ok(!html.includes('&lt;@633846213002919966&gt;'), 'raw mention still present in top XP');
  assert.ok(!html.includes('&lt;@1204261888549064738&gt;'), 'raw mention still present in top commands');
  assert.ok(!html.includes('&lt;@999999999999999999&gt;'), 'raw mention still present for unknown user');
  assert.ok(html.includes('#the-mead-hall'), 'top channel name resolution broke');
  assert.ok(html.includes('<td>1500</td>'), 'XP column missing');
  assert.ok(html.includes('<td>6</td>'), 'commands_used column missing');
  console.log('template render: OK — labels in both leaderboards, no raw mentions, channels + numeric columns intact');
  console.log('ALL CHECKS PASSED');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
