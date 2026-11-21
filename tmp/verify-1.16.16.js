// Verify 1.16.16: backup pipe race fix (ERR_STREAM_WRITE_AFTER_END crash).
// The old runBackup() called out.end() in the mysqldump 'close' handler,
// racing gzip's async flush: the file was truncated (a 10-byte file — just
// the gzip header — was reported as a successful backup under threadpool
// load) and, on Node 20, the late flush write threw ERR_STREAM_WRITE_AFTER_END
// as an unhandled stream error and killed the process (the 1.16.14/1.16.15
// dashboard deaths and Nov 16 log row #179). The fix never ends `out`
// manually (pipe() ends it once gzip flushes), declares success only once
// both mysqldump has exited AND the pipeline has drained, unlinks partial
// files only after the drain, and resolves stream errors as failed backups
// instead of crashing. A fake mysqldump on PATH stands in for the real one
// (not installed in this sandbox); nothing here is a real credential.
'use strict';

process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');

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

// --- Fake config / database (same shape as verify-1.16.15.js) ----------------
// Values are invented test strings, never read from config.json.
const config = require(path.join(root, 'src', 'utils', 'config'));
config.database = { host: '127.0.0.1', port: 3306, user: 'test', password: 'test-password-not-real', database: 'test' };
config.backups = { time: '03:00', retentionDays: 30 };
const { runBackup, BACKUP_DIR } = require(path.join(root, 'scripts', 'backup-db'));

// --- Fake mysqldump -----------------------------------------------------------
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1.16.16-fakebin-'));
const DUMP_LINE = "INSERT INTO guild_settings VALUES (1571439343976058970, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');\n";
function writeFakeMysqldump({ lines, exitCode = 0, stderr = '' } = {}) {
  const script = '#!/bin/bash\n' +
    `yes ${JSON.stringify(DUMP_LINE.trimEnd())} | head -n ${lines}\n` +
    (stderr ? `echo ${JSON.stringify(stderr)} >&2\n` : '') +
    `exit ${exitCode}\n`;
  fs.writeFileSync(path.join(fakeBin, 'mysqldump'), script, { mode: 0o755 });
}
function expectedDump(lines) {
  return Buffer.from(DUMP_LINE.repeat(lines));
}
function readBackup(filename) {
  const gz = fs.readFileSync(path.join(BACKUP_DIR, filename));
  return zlib.gunzipSync(gz);
}
function cleanupBackup(filename) {
  try { fs.unlinkSync(path.join(BACKUP_DIR, filename)); } catch {}
}
const savedPath = process.env.PATH;
function useFakeMysqldump() { process.env.PATH = fakeBin + ':' + savedPath; }
function useNoMysqldump() { process.env.PATH = fakeBin + ':/nonexistent-dir-for-verify-1.16.16'; fs.unlinkSync(path.join(fakeBin, 'mysqldump')); }

(async () => {
  await check('package.json is 1.16.16 with the changelog entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.16');
    const changelog = src('CHANGELOG.md');
    assert.ok(changelog.includes('## [1.16.16] - 2026-11-21'), 'missing 1.16.16 changelog entry');
    assert.ok(changelog.includes('ERR_STREAM_WRITE_AFTER_END'), 'changelog does not name the crash');
  });

  await check('runBackup no longer ends out manually; stream errors are handled; success waits for exit + drain', () => {
    const code = src('scripts/backup-db.js');
    // The old code called out.end(); as a statement inside the close
    // handler; the new code never calls out.end() at all — pipe() ends it
    // once gzip flushes. (The comment in checkDone mentions out.end() in
    // prose, so match the statement form with its semicolon.)
    assert.ok(!/out\.end\(\);/.test(code), 'runBackup still calls out.end()');
    assert.ok(code.includes("gzip.on('error'"), 'no error listener on gzip');
    assert.ok(code.includes("out.on('error'"), 'no error listener on out');
    assert.ok(code.includes('out.writableFinished'), 'success does not wait for the pipeline to drain');
    assert.ok(code.includes("out.on('finish'"), 'finish listener is not attached at setup');
  });

  await check('runBackup success: large dump writes a complete, byte-identical backup', async () => {
    writeFakeMysqldump({ lines: 150000 });
    useFakeMysqldump();
    const r = await runBackup();
    assert.strictEqual(r.ok, true, 'runBackup failed: ' + JSON.stringify(r));
    const content = readBackup(r.filename);
    assert.ok(content.equals(expectedDump(150000)), `backup content mismatch: got ${content.length} bytes, expected ${expectedDump(150000).length}`);
    cleanupBackup(r.filename);
  });

  await check('runBackup success under threadpool flood (x3): files are complete, not truncated', async () => {
    // The old code truncated 2 of 3 flood runs to a 10-byte file (just the
    // gzip header) while reporting success. Each run must decompress to the
    // exact expected bytes.
    writeFakeMysqldump({ lines: 10000 });
    useFakeMysqldump();
    for (let i = 0; i < 3; i++) {
      const p = runBackup();
      setTimeout(() => {
        for (let j = 0; j < 16; j++) crypto.pbkdf2('password', 'salt', 1000000, 64, 'sha512', () => {});
      }, 100);
      const r = await p;
      assert.strictEqual(r.ok, true, `flood run ${i + 1} failed: ` + JSON.stringify(r));
      const content = readBackup(r.filename);
      assert.ok(content.equals(expectedDump(10000)), `flood run ${i + 1} truncated: got ${content.length} bytes, expected ${expectedDump(10000).length}`);
      cleanupBackup(r.filename);
    }
  });

  await check('runBackup failure (mysqldump exits 1): ok:false, names the exit code, partial file unlinked', async () => {
    writeFakeMysqldump({ lines: 100, exitCode: 1, stderr: 'mysqldump: Got error: 1045: Access denied' });
    useFakeMysqldump();
    const before = new Set(fs.readdirSync(BACKUP_DIR));
    const r = await runBackup();
    assert.strictEqual(r.ok, false, 'runBackup should have failed');
    assert.ok(String(r.error).includes('exited with code 1'), 'error does not name exit code 1: ' + r.error);
    const after = fs.readdirSync(BACKUP_DIR).filter((f) => !before.has(f));
    assert.strictEqual(after.length, 0, 'partial backup file was not unlinked: ' + after.join(', '));
  });

  await check('runBackup with no mysqldump installed: ok:false, names the failed start (backup-now 500)', async () => {
    useNoMysqldump();
    const r = await runBackup();
    assert.strictEqual(r.ok, false, 'runBackup should have failed without mysqldump');
    assert.ok(String(r.error).includes('failed to start'), 'error does not name the failed start: ' + r.error);
  });

  await check('check-deploy.js: 39 top-level, 0 problems', () => {
    // Use the absolute node binary and the saved PATH: earlier tests
    // replaced PATH to hide mysqldump, and /bin/sh would not find `node`.
    const out = execSync(`"${process.execPath}" check-deploy.js`, { cwd: root, env: { ...process.env, PATH: savedPath, ALLOW_PLACEHOLDER_CONFIG: '1' }, encoding: 'utf8' });
    assert.ok(out.includes('top-level commands: 39'), 'top-level count is not 39:\n' + out);
    assert.ok(out.includes('problems: 0'), 'problems is not 0:\n' + out);
  });

  // Restore PATH and remove the fake bin dir.
  process.env.PATH = savedPath;
  try { fs.rmSync(fakeBin, { recursive: true, force: true }); } catch {}

  console.log(`\n${passed} passed, ${failed} failed${failed ? ' — ' + failures.join(', ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('VERIFY HARNESS ERROR:', err);
  process.env.PATH = savedPath;
  process.exit(1);
});
