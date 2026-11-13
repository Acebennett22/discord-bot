// Invite-based auto-roles (1.11.6): joining via a specific invite code
// grants a configured role (e.g. the "youtube" link grants "From YouTube").
// The rule is keyed on the invite CODE, not the inviter — it hooks into the
// invite tracker's join detection in recordJoin().
const db = require('./database');

async function listRules(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM invite_role_rules WHERE guild_id = ? ORDER BY invite_code', [guildId])) || [];
}

async function getRule(guildId, code) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM invite_role_rules WHERE guild_id = ? AND invite_code = ?', [guildId, code]);
  return rows?.[0] || null;
}

async function addRule(guildId, code, roleId, createdBy) {
  if (!db.isEnabled()) return null;
  await db.query(
    'INSERT INTO invite_role_rules (guild_id, invite_code, role_id, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), created_by = VALUES(created_by)',
    [guildId, code, roleId, createdBy || null],
  );
  return getRule(guildId, code);
}

async function removeRule(guildId, code) {
  const rule = await getRule(guildId, code);
  if (!rule) return null;
  await db.query('DELETE FROM invite_role_rules WHERE guild_id = ? AND invite_code = ?', [guildId, code]);
  return rule;
}

// Called from inviteTracker.recordJoin once the used invite code is known.
// Never throws — a failed role grant must never break the join flow.
async function grantInviteRole(member, inviteCode) {
  if (!inviteCode || inviteCode === 'unknown' || inviteCode === 'vanity') return null;
  try {
    const rule = await getRule(member.guild.id, inviteCode);
    if (!rule) return null;
    const role = member.guild.roles.cache.get(rule.role_id);
    if (!role) return null;
    if (member.roles.cache.has(role.id)) return role;
    const me = member.guild.members.me;
    if (!me || role.position >= me.roles.highest.position) return null;
    await member.roles.add(role, `Joined via invite discord.gg/${inviteCode}`).catch(() => null);
    return role;
  } catch { return null; }
}

module.exports = { listRules, getRule, addRule, removeRule, grantInviteRole };
