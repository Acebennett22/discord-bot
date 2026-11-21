// Verify 1.16.11: helmet 8.3.0 + express-rate-limit 8.7.5, with the
// rate-limit option renamed max -> limit (v8's supported name; max is a
// deprecated alias in 8.x). Exercises the REAL installed packages behind
// tiny express apps using the dashboard's exact middleware options, plus
// source checks on the dashboard wiring. No live bot or dashboard.
'use strict';

// The sandbox config.json holds placeholder credentials, and config.js
// exits on them — the dashboard's own setup-wizard escape hatch
// (ALLOW_PLACEHOLDER_CONFIG=1) is the documented way to load code without
// a real token. Nothing here reaches Discord or the real dashboard.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');

// --- Test harness (same shape as tmp/verify-1.16.10.js) ----------------------
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

function installedVersion(pkg) {
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
}

// Fire one GET at a listening express app and return { status, headers }.
function get(port, reqPath = '/') {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    }).on('error', reject);
  });
}

async function main() {
  const dashboardSrc = src('src/dashboard.js');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  await check('package.json pins helmet ^8.3.0 and express-rate-limit ^8.7.5', () => {
    assert.strictEqual(pkg.dependencies.helmet, '^8.3.0');
    assert.strictEqual(pkg.dependencies['express-rate-limit'], '^8.7.5');
  });

  await check('installed versions are exactly 8.3.0 and 8.7.5 (never 8.0.0-8.2.1)', () => {
    assert.strictEqual(installedVersion('helmet'), '8.3.0');
    assert.strictEqual(installedVersion('express-rate-limit'), '8.7.5');
  });

  await check('dashboard rate limiter uses limit, not the deprecated max', () => {
    const m = dashboardSrc.match(/rateLimit\(\{[^}]*\}\)/);
    assert.ok(m, 'no rateLimit({...}) call found in dashboard.js');
    assert.ok(m[0].includes('limit: 300'), `rateLimit call is not limit: 300 (got ${m[0]})`);
    assert.ok(!m[0].includes('max:'), 'rateLimit call still uses max:');
  });

  await check('no other rateLimit usage anywhere in src/', () => {
    const files = [];
    (function walk(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.js')) files.push(p);
      }
    })(path.join(root, 'src'));
    const users = files.filter((f) => src(path.relative(root, f)).includes('rateLimit('));
    assert.deepStrictEqual(users, [path.join(root, 'src', 'dashboard.js')]);
  });

  await check('dashboard still wires helmet with CSP disabled', () => {
    assert.ok(dashboardSrc.includes('app.use(helmet({ contentSecurityPolicy: false }))'),
      'helmet wiring changed or missing');
    assert.ok(dashboardSrc.includes("require('helmet')"), 'helmet require missing');
  });

  await check('dashboard rate-limit values are unchanged (15 min window, 300)', () => {
    const m = dashboardSrc.match(/rateLimit\(\{\s*windowMs:\s*([^,]+),\s*limit:\s*(\d+)\s*\}\)/);
    assert.ok(m, 'could not parse the rateLimit options');
    assert.strictEqual(eval(m[1]), 15 * 60_000); // eslint-disable-line no-eval
    assert.strictEqual(Number(m[2]), 300);
  });

  // --- Functional: the real v8 limiter honors `limit` -------------------------
  await check('real rate-limit v8 limiter: requests past limit get 429', async () => {
    const express = require('express');
    const rateLimit = require('express-rate-limit');
    const app = express();
    // Same option shape as the dashboard (windowMs + limit), small limit
    // so the test runs in 4 requests instead of 301.
    app.use(rateLimit({ windowMs: 15 * 60_000, limit: 3 }));
    app.get('/', (req, res) => res.send('ok'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await get(server.address().port)).status);
      assert.deepStrictEqual(statuses, [200, 200, 200, 429],
        `expected 3x200 then 429, got ${statuses.join(',')}`);
    } finally {
      server.close();
    }
  });

  await check('real rate-limit v8 limiter: deprecated max still works (alias, not required)', async () => {
    // Documents the 8.7.5 source: `limit: notUndefinedOptions.max ?? 5` —
    // the old option still functions, so the rename is a migration off a
    // deprecated alias, not a fix for a crash.
    const express = require('express');
    const rateLimit = require('express-rate-limit');
    const app = express();
    app.use(rateLimit({ windowMs: 15 * 60_000, max: 2 }));
    app.get('/', (req, res) => res.send('ok'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await get(server.address().port)).status);
      assert.deepStrictEqual(statuses, [200, 200, 429]);
    } finally {
      server.close();
    }
  });

  // --- Functional: the real helmet 8 with the dashboard's exact options ------
  await check('real helmet 8: dashboard options set security headers, no CSP', async () => {
    const express = require('express');
    const helmet = require('helmet');
    const app = express();
    app.use(helmet({ contentSecurityPolicy: false }));
    app.get('/', (req, res) => res.send('ok'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    try {
      const { status, headers } = await get(server.address().port);
      assert.strictEqual(status, 200);
      assert.strictEqual(headers['x-dns-prefetch-control'], 'off');
      assert.strictEqual(headers['x-frame-options'], 'SAMEORIGIN');
      assert.ok(headers['strict-transport-security'],
        'Strict-Transport-Security header missing (helmet 8 max-age is 365 days)');
      assert.ok(!('content-security-policy' in headers),
        'CSP header present even though the dashboard disables it');
    } finally {
      server.close();
    }
  });

  await check('package.json is 1.16.11 and CHANGELOG has the entry', () => {
    assert.strictEqual(pkg.version, '1.16.11');
    assert.ok(src('CHANGELOG.md').includes('## [1.16.11]'), 'no 1.16.11 CHANGELOG entry');
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
