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
    dump.stderr.on('data', (d) => { stderr += d.toString(); });
    dump.on('error', async (err) => {
      const msg = `mysqldump failed to start: ${err.message} (is mysqldump installed?)`;
      await errorLogger.log({ level: 'error', message: `Backup failed: ${msg}`, context: { type: 'backup' } });
      await logRun(filename, null, 'failed', msg);
      resolve({ ok: false, error: msg });
    });
    dump.on('close', async (code) => {
      if (code !== 0) {
        const msg = `mysqldump exited with code ${code}: ${stderr.slice(0, 500)}`;
        await errorLogger.log({ level: 'error', message: `Backup failed: ${msg}`, context: { type: 'backup' } });
        await logRun(filename, null, 'failed', msg);
        try { fs.unlinkSync(outPath); } catch {}
        return resolve({ ok: false, error: msg });
      }
      out.end();
      out.on('finish', async () => {
        const size = fs.statSync(outPath).size;
        await logRun(filename, size, 'success', null);
        await pruneOldBackups();
        console.log(`[backup] Saved ${filename} (${(size / 1024).toFixed(1)} KB).`);
        resolve({ ok: true, filename, sizeBytes: size });
      });
    });
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
