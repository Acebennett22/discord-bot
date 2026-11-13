// Self-assignable color roles (1.4.4): one color role per member at a time.
// A role is only assignable if it sits below the bot's highest role.
const db = require('./database');

async function getColorRoles(guildId) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT role_id, hex, name FROM color_roles WHERE guild_id = ? ORDER BY name', [guildId]) || [];
}

async function addColorRole(guildId, roleId, hex, name) {
  await db.query(
    'INSERT INTO color_roles (guild_id, role_id, hex, name) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE hex = VALUES(hex), name = VALUES(name)',
    [guildId, roleId, hex, name || null],
  );
}

async function removeColorRole(guildId, roleId) {
  await db.query('DELETE FROM color_roles WHERE guild_id = ? AND role_id = ?', [guildId, roleId]);
}

function botCanManageRole(guild, role) {
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, reason: 'The bot is not in this server.' };
  if (role.position >= botMember.roles.highest.position) {
    return { ok: false, reason: `The **${role.name}** role is above (or equal to) the bot's highest role — move the bot's role higher in Server Settings → Roles.` };
  }
  return { ok: true };
}

async function setMemberColor(member, roleId) {
  const colorRoles = await getColorRoles(member.guild.id);
  const target = colorRoles.find((r) => r.role_id === roleId);
  if (!target) return { ok: false, error: 'That role is not a registered color role in this server.' };
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, error: 'That role no longer exists.' };
  const check = botCanManageRole(member.guild, role);
  if (!check.ok) return { ok: false, error: check.reason };
  // Remove any other color roles first — one color at a time.
  const others = colorRoles.map((r) => r.role_id).filter((id) => id !== roleId && member.roles.cache.has(id));
  if (others.length) await member.roles.remove(others).catch(() => {});
  if (!member.roles.cache.has(roleId)) await member.roles.add(role);
  return { ok: true, role };
}

async function removeMemberColor(member) {
  const colorRoles = await getColorRoles(member.guild.id);
  const mine = colorRoles.map((r) => r.role_id).filter((id) => member.roles.cache.has(id));
  if (!mine.length) return { ok: false, error: 'You don\'t have a color role right now.' };
  await member.roles.remove(mine).catch(() => {});
  return { ok: true, removed: mine.length };
}

module.exports = { getColorRoles, addColorRole, removeColorRole, botCanManageRole, setMemberColor, removeMemberColor };
