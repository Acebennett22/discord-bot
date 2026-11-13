// Temporary roles (1.5.2): grant a role with an expiry; a timer removes
// expired roles every minute and logs the removal to the DB (and the modlog
// channel if one is set, via message_logs style — here: errorLogger info).
const db = require('./database');
const { logWarn } = require('./errorLogger');

function parseDuration(str) {
  const m = /^(\d+)([smhd])$/.exec(String(str || '').trim().toLowerCase());
  if (!m) return null;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  const ms = parseInt(m[1], 10) * mult;
  return ms > 0 && ms <= 365 * 86_400_000 ? ms : null;
}

function botCanManageRole(guild, role) {
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, reason: 'The bot is not in this server.' };
  if (role.position >= botMember.roles.highest.position) {
    return { ok: false, reason: `The **${role.name}** role is above (or equal to) the bot's highest role — move the bot's role higher in Server Settings → Roles.` };
  }
  return { ok: true };
}

async function grantTempRole(guild, member, role, durationMs, grantedBy, reason) {
  const check = botCanManageRole(guild, role);
  if (!check.ok) return { ok: false, error: check.reason };
  await member.roles.add(role, reason || 'Temporary role');
  const expiresAt = new Date(Date.now() + durationMs);
  await db.query(
    'INSERT INTO temp_roles (guild_id, user_id, role_id, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)',
    [guild.id, member.id, role.id, grantedBy?.id || null, expiresAt],
  );
  return { ok: true, expiresAt };
}

async function removeTempRole(guild, userId, roleId, { early = false } = {}) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    const role = guild.roles.cache.get(roleId);
    if (role && member.roles.cache.has(roleId)) {
      await member.roles.remove(role, early ? 'Temporary role removed early' : 'Temporary role expired').catch(() => {});
    }
  }
  await db.query('UPDATE temp_roles SET removed = 1 WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed = 0', [guild.id, userId, roleId]);
}

async function checkExpiredTempRoles(client) {
  if (!db.isEnabled()) return 0;
  const rows = await db.query('SELECT * FROM temp_roles WHERE removed = 0 AND expires_at <= NOW()') || [];
  let removed = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id).catch(() => null);
    if (!guild) { await db.query('UPDATE temp_roles SET removed = 1 WHERE id = ?', [row.id]); continue; }
    await removeTempRole(guild, row.user_id, row.role_id).catch((e) => logWarn('temp role removal failed', { guildId: row.guild_id, userId: row.user_id, error: e.message }));
    removed += 1;
  }
  return removed;
}

let started = false;
function startTempRoleChecker(client) {
  if (started) return;
  started = true;
  setInterval(() => checkExpiredTempRoles(client).catch(() => {}), 60_000);
  setTimeout(() => checkExpiredTempRoles(client).catch(() => {}), 10_000);
}

async function getActiveTempRoles(guildId) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT * FROM temp_roles WHERE guild_id = ? AND removed = 0 AND expires_at > NOW() ORDER BY expires_at', [guildId]) || [];
}

module.exports = { parseDuration, botCanManageRole, grantTempRole, removeTempRole, checkExpiredTempRoles, startTempRoleChecker, getActiveTempRoles };
