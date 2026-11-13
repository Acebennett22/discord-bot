// Restore a backup:  node scripts/restore-db.js <filename> --confirm
// The file must live in backups/. Restore OVERWRITES the current database —
// the --confirm flag (or answering "yes" interactively) is required.
//   gunzip -c backups/<file> | mysql -u <user> -p <database>
// is the equivalent manual command (see README).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const config = require('../src/utils/config');

async function main() {
  const filename = process.argv[2];
  const confirmed = process.argv.includes('--confirm');
  if (!filename || filename.startsWith('-')) {
    console.log('Usage: node scripts/restore-db.js <backup-file.sql.gz> --confirm');
    console.log('Backups live in backups/. Listing:');
    const dir = path.join(__dirname, '..', 'backups');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql.gz'))) console.log('  ' + f);
    process.exit(1);
  }
  const file = path.resolve(path.join(__dirname, '..', 'backups'), path.basename(filename));
  if (!fs.existsSync(file)) { console.error(`Backup not found: ${file}`); process.exit(1); }
  if (!confirmed) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((res) => rl.question(`Restore ${path.basename(file)} into database "${config.database?.database}"? This OVERWRITES current data. Type "yes" to continue: `, res));
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') { console.log('Restore cancelled.'); process.exit(0); }
  }
  const cfg = config.database || {};
  const mysql = spawn('mysql', ['-h', cfg.host || 'localhost', '-P', String(cfg.port || 3306), '-u', cfg.user || 'discord_bot', cfg.database || 'discord_bot'],
    { env: { ...process.env, MYSQL_PWD: cfg.password } });
  fs.createReadStream(file).pipe(zlib.createGunzip()).pipe(mysql.stdin);
  let stderr = '';
  mysql.stderr.on('data', (d) => { stderr += d.toString(); });
  mysql.on('close', (code) => {
    if (code === 0) console.log(`✅ Restored ${path.basename(file)} into ${cfg.database}.`);
    else { console.error(`Restore failed (exit ${code}): ${stderr.slice(0, 500)}`); process.exit(1); }
  });
  mysql.on('error', (err) => { console.error('mysql failed to start:', err.message); process.exit(1); });
}

if (require.main === module) main();
module.exports = {};
