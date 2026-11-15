// Verification for 1.15.12 (dashboard error-log purge: purge-all + purge-selected).
// Usage: node tmp/verify-1.15.12.js
// No real MySQL in this sandbox, so the DB is a fake in-memory error_logs
// table injected by stubbing src/utils/database in the require cache BEFORE
// errorLogger is loaded. The log file, marker file, and retry queue are REAL.
// The script backs up logs/bot-errors.log (if any) and the marker file and
// restores them afterwards. Also boots the real dashboard in wizard mode and
// checks the purge route's staff gate over HTTP.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'bot-errors.log');
const MARKER_FILE = path.join(ROOT, 'logs', '.error-logs-purged-at');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  // --- Back up real log state -------------------------------------------
  const hadLog = fs.existsSync(LOG_FILE);
  const logBackup = hadLog ? fs.readFileSync(LOG_FILE) : null;
  const hadMarker = fs.existsSync(MARKER_FILE);
  const markerBackup = hadMarker ? fs.readFileSync(MARKER_FILE) : null;

  try {
    // --- Fake DB ---------------------------------------------------------
    let table = []; // { id, level, message }
    let nextId = 1;
    let dbEnabled = true;
    const inserts = [];
    const fakeDb = {
      isEnabled: () => dbEnabled,
      initDatabase: async () => true,
      logCommand: async () => {},
      closePool: async () => {},
      query: async (sql, params = []) => {
        if (/^DELETE FROM error_logs$/.test(sql)) {
          const n = table.length; table = []; return { affectedRows: n };
        }
        if (/^DELETE FROM error_logs WHERE id IN \(/.test(sql)) {
          const before = table.length;
          table = table.filter((r) => !params.includes(r.id));
          return { affectedRows: before - table.length };
        }
        if (/^INSERT INTO error_logs/.test(sql)) {
          const row = { id: nextId++, level: params[0], message: params[5] };
          table.push(row); inserts.push(row); return { affectedRows: 1, insertId: row.id };
        }
        if (!strictSql) return [];
        throw new Error('unexpected SQL in fake: ' + sql);
      },
    };
    let strictSql = true;
    const dbPath = require.resolve(path.join(ROOT, 'src', 'utils', 'database.js'));
    require.cache[dbPath] = { exports: fakeDb };

    const errorLogger = require(path.join(ROOT, 'src', 'utils', 'errorLogger.js'));
    const seed = (n) => { for (let i = 0; i < n; i++) table.push({ id: nextId++, level: 'error', message: 'seed ' + i }); };
    const writeLogLines = (n) => {
      fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
      fs.writeFileSync(LOG_FILE, Array.from({ length: n }, (_, i) => JSON.stringify({ message: 'line ' + i }) + '\n').join(''));
    };
    const logLineCount = () => (fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : -1);

    // --- Test 1: purge-all ----------------------------------------------
    seed(3); writeLogLines(3);
    errorLogger.retryQueue.push({ level: 'error', message: 'queued old', created_at: new Date(Date.now() - 60000).toISOString() });
    const r1 = await errorLogger.purgeErrorLogs();
    check('purge-all deletes all rows', r1.deleted === 3 && table.length === 0, `deleted=${r1.deleted} remaining=${table.length}`);
    check('purge-all mode + fileCleared + dbAvailable', r1.mode === 'all' && r1.fileCleared === true && r1.dbAvailable === true, JSON.stringify(r1));
    check('purge-all truncates the log file', logLineCount() === 0, `lines=${logLineCount()}`);
    check('purge-all writes a purge marker', fs.existsSync(MARKER_FILE) && Math.abs(Date.now() - parseInt(fs.readFileSync(MARKER_FILE, 'utf8'), 10)) < 60_000);
    check('purge-all clears the local retry queue', errorLogger.retryQueue.length === 0, `len=${errorLogger.retryQueue.length}`);

    // --- Test 2: flushQueue drops pre-purge entries, keeps post-purge ----
    const markerMs = parseInt(fs.readFileSync(MARKER_FILE, 'utf8'), 10);
    const oldEntry = { level: 'error', message: 'old queued', created_at: new Date(markerMs - 5000).toISOString() };
    const newEntry = { level: 'error', message: 'new queued', created_at: new Date(markerMs + 5000).toISOString() };
    errorLogger.retryQueue.push(oldEntry, newEntry);
    inserts.length = 0;
    await errorLogger.flushQueue();
    check('flushQueue drops entries logged before the purge', errorLogger.retryQueue.length === 0 && inserts.length === 1 && inserts[0].message === 'new queued', `inserts=${JSON.stringify(inserts.map((i) => i.message))}`);
    check('flushed post-purge entry landed in the table', table.some((r) => r.message === 'new queued') && !table.some((r) => r.message === 'old queued'));

    // --- Test 3: purge-selected ------------------------------------------
    const markerBefore = fs.readFileSync(MARKER_FILE, 'utf8');
    table = []; nextId = 1; seed(3); writeLogLines(3);
    const ids = table.map((r) => r.id);
    const r3 = await errorLogger.purgeErrorLogs([ids[1]]);
    check('purge-selected deletes only the chosen row', r3.deleted === 1 && table.length === 2 && !table.some((r) => r.id === ids[1]), `deleted=${r3.deleted} remaining=${table.map((r) => r.id)}`);
    check('purge-selected mode + file untouched', r3.mode === 'selected' && r3.fileCleared === false && logLineCount() === 3, JSON.stringify(r3) + ` lines=${logLineCount()}`);
    check('purge-selected does not rewrite the marker', fs.readFileSync(MARKER_FILE, 'utf8') === markerBefore);
    check('purge-selected leaves the retry queue alone', (() => {
      errorLogger.retryQueue.push({ level: 'error', message: 'q', created_at: new Date().toISOString() });
      const len = errorLogger.retryQueue.length; errorLogger.retryQueue.length = 0; return len === 1;
    })());

    // --- Test 4: invalid ids never become purge-all ----------------------
    table = []; seed(2);
    let threw = false;
    try { await errorLogger.purgeErrorLogs(['abc', '0', '-3']); } catch (e) { threw = /No valid/.test(e.message); }
    check('purge with no valid ids throws (never purges all)', threw && table.length === 2, `remaining=${table.length}`);
    threw = false;
    try { await errorLogger.purgeErrorLogs([]); } catch (e) { threw = /No valid/.test(e.message); }
    check('purge with empty id list throws', threw && table.length === 2);

    // --- Test 5: DB-down purge-all still clears file + marker ------------
    dbEnabled = false;
    writeLogLines(2);
    const r5 = await errorLogger.purgeErrorLogs();
    check('DB-down purge-all reports dbAvailable=false, deleted=0', r5.deleted === 0 && r5.dbAvailable === false && r5.mode === 'all', JSON.stringify(r5));
    check('DB-down purge-all still truncates file + marker', r5.fileCleared === true && logLineCount() === 0 && fs.existsSync(MARKER_FILE));
    dbEnabled = true;

    // --- Test 6: EJS renders (errors + empty) ----------------------------
    const ejs = require('ejs');
    const tpl = fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'staff.ejs'), 'utf8');
    const render = (errors) => ejs.render(tpl, {
      section: 'errors', saved: false, user: {}, isStaff: true, inviteUrl: '',
      data: { errors, filters: { level: '', command: '', shard: '' } },
    }, { filename: path.join(ROOT, 'dashboard', 'views', 'staff.ejs') });
    const html = render([
      { id: 1, level: 'error', shard_id: 0, command_name: 'play', message: 'boom', created_at: '2026-11-15', resolved: 0 },
      { id: 2, level: 'warn', shard_id: null, command_name: null, message: 'w', created_at: '2026-11-15', resolved: 1 },
    ]);
    const need = ['purge-all-errors', 'purge-selected-errors', 'select-all-errors', 'error-select',
      'Purge selected deletes only the checked rows', 'id="purge-selected-errors" disabled'];
    check('errors view renders purge UI (buttons, checkboxes, note)', need.every((s) => html.includes(s)), need.filter((s) => !html.includes(s)).join(', '));
    check('errors view renders one checkbox per row', (html.match(/class="error-select"/g) || []).length === 2);
    const htmlEmpty = render([]);
    check('empty errors view still shows purge buttons', htmlEmpty.includes('purge-all-errors') && htmlEmpty.includes('purge-selected-errors'));

    // --- Test 7: dashboard boots + purge route is staff-gated ------------
    // In-process boot with seeded config (same approach as
    // tmp/verify-session-store.js): the wizard-mode redirect would mask
    // every route, so seed a complete config instead.
    strictSql = false;
    const configPath = path.join(ROOT, 'src', 'utils', 'config.js');
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {
        token: 'x'.repeat(59), clientId: '1'.repeat(18), setupComplete: true, staffUserIds: [], database: {},
        dashboard: { port: 3101, redirectUri: 'http://localhost:3101/callback', clientSecret: 'secret', sessionSecret: 'test-secret-1234567890' },
      },
    };
    require(path.join(ROOT, 'src', 'dashboard.js'));
    const base = 'http://127.0.0.1:3101';
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { await fetch(`${base}/version`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    check('dashboard boots with seeded config', up);
    const noRedirect = { redirect: 'manual' };
    const purgeRes = await fetch(`${base}/api/staff/errors/purge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...noRedirect });
    check('unauthenticated POST /api/staff/errors/purge redirects to /login (staff-gated, route exists)', purgeRes.status === 302 && (purgeRes.headers.get('location') || '').includes('/login'), `status=${purgeRes.status} location=${purgeRes.headers.get('location')}`);
    const purgeGet = await fetch(`${base}/api/staff/errors/purge`, noRedirect);
    check('GET /api/staff/errors/purge is not a route (no accidental GET purge)', purgeGet.status === 404, `status=${purgeGet.status}`);
    const staffPage = await fetch(`${base}/staff/errors`, noRedirect);
    check('unauthenticated GET /staff/errors also redirects to /login', staffPage.status === 302 && (staffPage.headers.get('location') || '').includes('/login'), `status=${staffPage.status}`);

    // --- Test 8: deploy payload unchanged --------------------------------
    const deployOut = execSync('node check-deploy.js', { cwd: ROOT, env: { ...process.env, ALLOW_PLACEHOLDER_CONFIG: '1' }, encoding: 'utf8' });
    check('check-deploy: 37 top-level, 0 problems', /top-level commands: 37/.test(deployOut) && /problems: 0/.test(deployOut), deployOut.split('\n').slice(-4).join(' '));
  } finally {
    // --- Restore real log state ------------------------------------------
    try {
      if (hadLog) fs.writeFileSync(LOG_FILE, logBackup);
      else if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
      if (hadMarker) fs.writeFileSync(MARKER_FILE, markerBackup);
      else if (fs.existsSync(MARKER_FILE)) fs.unlinkSync(MARKER_FILE);
    } catch (e) { console.log('WARN restore failed: ' + e.message); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY CRASH:', e); process.exit(1); });
