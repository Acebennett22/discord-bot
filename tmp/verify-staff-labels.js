// Verification for 1.15.1: resolver with a mock fetch + EJS render of the
// staff manage section with sample enriched rows. Run from the repo root:
//   node tmp/verify-staff-labels.js
// (Same ALLOW_PLACEHOLDER_CONFIG the dashboard sets before requiring config.)
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { resolveUserLabels } = require('../src/utils/userLabels');

(async () => {
  // --- Resolver: mock fetch -------------------------------------------------
  let calls = 0;
  const mockFetch = async (id) => {
    calls++;
    if (id === '111111111111111111') return { id, username: 'acebennett22', global_name: 'Ace' };
    if (id === '222222222222222222') return { id, username: 'nashb', global_name: null };
    if (id === '333333333333333333') throw new Error('404 Not Found'); // left Discord
    return null;
  };

  // Duplicates + nulls in input: each real ID fetched exactly once.
  const labels = await resolveUserLabels(
    ['111111111111111111', '222222222222222222', '111111111111111111', '333333333333333333', null, undefined, ''],
    mockFetch,
  );
  assert.strictEqual(calls, 3, `expected 3 fetches (deduped), got ${calls}`);
  assert.strictEqual(labels.get('111111111111111111'), 'Ace (111111111111111111)');
  assert.strictEqual(labels.get('222222222222222222'), 'nashb (222222222222222222)'); // no global_name -> username
  assert.strictEqual(labels.get('333333333333333333'), '333333333333333333 (unknown user)'); // fetch threw
  console.log('resolver: OK — dedupe, display-name preference, unknown-user fallback');

  // --- Route enrichment shape (mirrors /staff/manage) -----------------------
  const list = [
    { user_id: '111111111111111111', added_by: '222222222222222222', role: 'admin', created_at: '2026-11-15 12:00:00' },
    { user_id: '333333333333333333', added_by: null, role: 'staff', created_at: '2026-11-15 12:30:00' },
  ];
  const staff = list.map((s) => ({
    ...s,
    user_label: labels.get(String(s.user_id)),
    added_by_label: s.added_by ? labels.get(String(s.added_by)) : 'System / config',
  }));
  assert.strictEqual(staff[0].user_label, 'Ace (111111111111111111)');
  assert.strictEqual(staff[0].added_by_label, 'nashb (222222222222222222)');
  assert.strictEqual(staff[1].user_label, '333333333333333333 (unknown user)');
  assert.strictEqual(staff[1].added_by_label, 'System / config');
  console.log('route enrichment: OK');

  // --- Template render -------------------------------------------------------
  const html = await ejs.renderFile(path.join(__dirname, '..', 'dashboard', 'views', 'staff.ejs'), {
    user: { username: 'Ace' },
    section: 'manage',
    data: { staff, audit: [], ownerId: '222222222222222222', bootstrap: [] },
    isStaff: true,
    inviteUrl: 'https://example.invalid/invite',
    saved: false,
  }, { async: true });
  assert.ok(html.includes('Ace (111111111111111111)'), 'member label missing from render');
  assert.ok(html.includes('nashb (222222222222222222)'), 'added-by label missing from render');
  assert.ok(html.includes('333333333333333333 (unknown user)'), 'unknown-user fallback missing from render');
  assert.ok(html.includes('System / config'), 'NULL added_by label missing from render');
  assert.ok(html.includes('<th>Staff member</th>'), 'new column header missing');
  console.log('template render: OK — all four labels present in /staff/manage output');
  console.log('ALL CHECKS PASSED');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
