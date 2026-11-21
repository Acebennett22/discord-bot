// Verify 1.16.12: node-cron 3.0.3 → 4.6.0 — the daily DB backup schedule
// (scripts/backup-db.js, the only usage site) still works on the new major.
// Exercises the REAL node-cron package and the REAL startBackupSchedule().
// No live bot, no real backup runs (the scheduled job is stopped again).
'use strict';

// The sandbox config.json holds placeholder credentials, and config.js
// exits on them — the dashboard's own setup-wizard escape hatch
// (ALLOW_PLACEHOLDER_CONFIG=1) is the documented way to load code without
// a real token. Nothing here reaches Discord or MySQL.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// --- Test harness (same shape as tmp/verify-1.16.11.js) ----------------------
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

function src(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function installedVersion(name) {
  // node-cron 4.x no longer exports ./package.json, so read the file
  // directly instead of require('<pkg>/package.json').
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}

async function main() {
  await check('package.json pins node-cron ^4.6.0 and 4.6.0 is installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies['node-cron'], '^4.6.0');
    assert.strictEqual(installedVersion('node-cron'), '4.6.0');
    assert.strictEqual(pkg.version, '1.16.12');
    assert.ok(src('CHANGELOG.md').includes('## [1.16.12]'), 'no 1.16.12 CHANGELOG entry');
  });

  await check('backup-db.js schedule call is unchanged (only usage site)', () => {
    const backupSrc = src('scripts/backup-db.js');
    assert.ok(backupSrc.includes("cron.schedule(`${mm} ${hh} * * *`, () => {"),
      'schedule call changed or missing');
    assert.ok(backupSrc.includes("require('node-cron')"), 'node-cron require missing');
  });

  await check('node-cron 4.6.0 is the only cron library in use', () => {
    // No other file may use node-cron directly — the audit scoped this
    // upgrade to scripts/backup-db.js:105, so a second direct usage would
    // be a surprise. (src/events/ready.js only mentions node-cron in a
    // comment and calls startBackupSchedule() — it does not require it.)
    const hits = [];
    const scanDirs = ['src', 'scripts'];
    for (const dir of scanDirs) {
      for (const rel of fs.readdirSync(path.join(root, dir), { recursive: true })) {
        if (typeof rel !== 'string' || !rel.endsWith('.js')) continue;
        const text = src(path.join(dir, rel));
        if (text.includes("require('node-cron')") || text.includes('cron.schedule(')) hits.push(path.join(dir, rel));
      }
    }
    if (src('src/dashboard.js').includes("require('node-cron')") || src('src/dashboard.js').includes('cron.schedule(')) hits.push('src/dashboard.js');
    assert.deepStrictEqual(hits.sort(), ['scripts/backup-db.js']);
  });

  await check('node-cron 4 validates the 03:00 expression and rejects junk', () => {
    const cron = require('node-cron');
    assert.strictEqual(cron.validate('0 3 * * *'), true);
    assert.strictEqual(cron.validate('not-a-cron'), false);
  });

  await check('a v4 scheduled job actually fires and can be stopped', async () => {
    const cron = require('node-cron');
    let fired = 0;
    const task = cron.schedule('* * * * * *', () => { fired += 1; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.ok(fired >= 1, `job did not fire in 2.5s (fired ${fired} times)`);
    } finally {
      task.stop();
    }
    const after = fired;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.strictEqual(fired, after, 'job kept firing after stop()');
  });

  await check('the real startBackupSchedule() registers the 03:00 job', async () => {
    const cron = require('node-cron');
    const before = cron.getTasks().size;
    const { startBackupSchedule } = require('../scripts/backup-db');
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => { lines.push(a.join(' ')); };
    try {
      startBackupSchedule();
    } finally {
      console.log = origLog;
    }
    assert.ok(lines.some((l) => l.includes('Daily backup scheduled at 03:00')),
      `no 03:00 schedule log (got: ${lines.join(' | ')})`);
    assert.strictEqual(cron.getTasks().size, before + 1, 'no new task registered');
    // Stop it again so the process can exit — the real 03:00 job must not
    // linger in a test run.
    cron.getTasks().forEach((t) => t.stop());
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
