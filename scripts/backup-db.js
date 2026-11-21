// Daily MySQL backup: mysqldump -> backups/YYYY-MM-DD-HHmm.sql.gz
// Credentials come from config.json and are passed via the MYSQL_PWD
// environment variable — never in argv, never printed in logs.
// Each run is logged to the backup_logs table (and to the error logger on
// failure). Retention: keep the last N days (config backups.retentionDays,
// default 30); older files are deleted after a successful new backup.
// Run manually:  npm run backup
// Scheduled:     the bot runs it daily at config backups.time (default 03:00)
//                via node-cron — see startBackupSchedule() below.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../src/utils/config');
const db = require('../src/utils/database');
const errorLogger = require('../src/utils/errorLogger');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function retentionDays() {
  return config.backups?.retentionDays ?? 30;
}

function backupFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.sql.gz`;
}

async function logRun(filename, sizeBytes, status, errorMessage) {
  if (!db.isEnabled()) return;
  await db.query('INSERT INTO backup_logs (filename, size_bytes, status, error_message) VALUES (?, ?, ?, ?)',
    [filename, sizeBytes, status, errorMessage || null]).catch(() => {});
}

async function pruneOldBackups() {
  const cutoff = Date.now() - retentionDays() * 86_400_000;
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    if (!file.endsWith('.sql.gz')) continue;
    const full = path.join(BACKUP_DIR, file);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
    } catch {}
  }
  return removed;
}

function runBackup() {
  return new Promise((resolve) => {
    const cfg = config.database || {};
    if (!cfg.password || cfg.password.includes('YOUR_')) {
      const err = 'Database password is not set in config.json — backup skipped.';
      errorLogger.log({ level: 'error', message: `Backup failed: ${err}`, context: { type: 'backup' } });
      logRun(null, null, 'failed', err).catch(() => {});
      return resolve({ ok: false, error: err });
    }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const filename = backupFilename();
    const outPath = path.join(BACKUP_DIR, filename);
    const dump = spawn('mysqldump', [
      '-h', cfg.host || 'localhost',
      '-P', String(cfg.port || 3306),
      '-u', cfg.user || 'discord_bot',
      '--single-transaction', '--routines', '--triggers',
      cfg.database || 'discord_bot',
    ], { env: { ...process.env, MYSQL_PWD: cfg.password } });
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(outPath);
    dump.stdout.pipe(gzip).pipe(out);
    let stderr = '';
    let exitCode = null;
    let failed = false;
    let settled = false;
    const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
    // A stream failure resolves as a failed backup, never a crash: the
    // dashboard has no uncaughtException handler, so an unhandled 'error'
    // event on any of these streams kills the process outright.
    const fail = async (msg) => {
      if (failed || settled) return;
      failed = true;
      try { dump.kill(); } catch {}
      gzip.destroy();
      out.destroy();
      await errorLogger.log({ level: 'error', message: `Backup failed: ${msg}`, context: { type: 'backup' } });
      await logRun(filename, null, 'failed', msg);
      settle({ ok: false, error: msg });
    };
    gzip.on('error', (err) => { fail(`Backup compression failed: ${err.message}`); });
    out.on('error', (err) => { fail(`Backup write failed: ${err.message}`); });
    if (dump.stdout) dump.stdout.on('error', (err) => { fail(`Backup dump stream failed: ${err.message}`); });
    dump.stderr.on('data', (d) => { stderr += d.toString(); });
    dump.on('error', (err) => {
      fail(`mysqldump failed to start: ${err.message} (is mysqldump installed?)`);
    });
    dump.on('close', (code) => {
      exitCode = code;
      checkDone();
    });
    // Attached here, not inside the close handler: if the pipeline already
    // drained before 'close' fires, a listener attached there would never
    // fire and the backup would hang.
    out.on('finish', () => { checkDone(); });
    async function checkDone() {
      // Success is declared only once BOTH mysqldump has exited AND the
      // gzip pipeline has fully drained into the file. Never call out.end()
      // here: pipe() ends `out` itself once gzip has flushed, and ending it
      // early races the flush — the file is truncated and, on Node 20, the
      // late flush write throws ERR_STREAM_WRITE_AFTER_END and crashes the
      // process (the 1.16.14/1.16.15 dashboard deaths and Nov 16 log row
      // #179). The partial file is only unlinked after the pipeline has
      // drained, so no write can be in flight when it is deleted.
      if (failed || settled) return;
      if (exitCode === null || !out.writableFinished) return;
      try {
        if (exitCode !== 0) {
          const msg = `mysqldump exited with code ${exitCode}: ${stderr.slice(0, 500)}`;
          await errorLogger.log({ level: 'error', message: `Backup failed: ${msg}`, context: { type: 'backup' } });
          await logRun(filename, null, 'failed', msg);
          try { fs.unlinkSync(outPath); } catch {}
          return settle({ ok: false, error: msg });
        }
        const size = fs.statSync(outPath).size;
        await logRun(filename, size, 'success', null);
        await pruneOldBackups();
        console.log(`[backup] Saved ${filename} (${(size / 1024).toFixed(1)} KB).`);
        settle({ ok: true, filename, sizeBytes: size });
      } catch (err) {
        await fail(`Backup finalize failed: ${err.message}`);
      }
    }
  });
}

function startBackupSchedule() {
  let cron;
  try { cron = require('node-cron'); } catch { console.warn('[backup] node-cron not installed — daily backups disabled. Run `npm install` or `npm run backup` manually.'); return; }
  const time = config.backups?.time || '03:00';
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) { console.warn(`[backup] Invalid backups.time "${time}" — daily backups disabled.`); return; }
  cron.schedule(`${mm} ${hh} * * *`, () => {
    console.log('[backup] Running scheduled daily backup…');
    runBackup().catch((e) => errorLogger.log({ level: 'error', message: `Scheduled backup failed: ${e.message}`, context: { type: 'backup' } }));
  });
  console.log(`[backup] Daily backup scheduled at ${time} (retention: ${retentionDays()} days).`);
}

if (require.main === module) {
  (async () => {
    await db.initDatabase();
    const result = await runBackup();
    process.exit(result.ok ? 0 : 1);
  })();
}

module.exports = { runBackup, startBackupSchedule, pruneOldBackups, retentionDays, BACKUP_DIR };
