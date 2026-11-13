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

// --- Personal color roles (1.13.11): one per member, named color-<user id>,
// tracked in user_color_roles. Unlike catalog roles these are created by
// the bot, not registered by an admin. ---------------------------------------

async function getUserColorRole(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT role_id FROM user_color_roles WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return rows?.[0]?.role_id || null;
}

// Create the member's personal color role if needed, or recolor it if it
// already exists. The role is positioned just below the bot's highest role
// so the bot can always manage it.
async function ensureUserColorRole(member, hex) {
  const guild = member.guild;
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, error: 'The bot is not in this server.' };
  const existingId = await getUserColorRole(guild.id, member.id);
  let role = existingId ? guild.roles.cache.get(existingId) : null;
  if (role) {
    const check = botCanManageRole(guild, role);
    if (!check.ok) return { ok: false, error: check.reason };
    try { await role.setColor(hex); } catch { return { ok: false, error: 'Discord wouldn\'t let me recolor your personal color role.' }; }
    return { ok: true, role, created: false };
  }
  try {
    role = await guild.roles.create({ name: `color-${member.id}`, color: hex, reason: `Personal color role for ${member.user.tag} (/color custom)` });
  } catch {
    return { ok: false, error: 'Discord wouldn\'t let me create your personal color role — the bot needs the Manage Roles permission.' };
  }
  // New roles land at the bottom of the list, which is already below the
  // bot's highest role; still nudge it up just under the bot so it sits
  // above other low roles (best-effort — a failure here is not fatal).
  await role.setPosition(Math.max(1, botMember.roles.highest.position - 1)).catch(() => {});
  await db.query(
    'INSERT INTO user_color_roles (guild_id, user_id, role_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)',
    [guild.id, member.id, role.id],
  );
  return { ok: true, role, created: true };
}

// Delete the member's personal color role (Discord role + DB row). Returns
// true when one existed.
async function removeUserColorRole(member) {
  const roleId = await getUserColorRole(member.guild.id, member.id);
  if (!roleId) return false;
  await db.query('DELETE FROM user_color_roles WHERE guild_id = ? AND user_id = ?', [member.guild.id, member.id]);
  const role = member.guild.roles.cache.get(roleId);
  if (role) await role.delete('Personal color role removed (/color remove)').catch(() => {});
  return true;
}

async function setMemberColor(member, roleId) {
  const colorRoles = await getColorRoles(member.guild.id);
  const target = colorRoles.find((r) => r.role_id === roleId);
  const personalId = await getUserColorRole(member.guild.id, member.id);
  const isPersonal = personalId === roleId;
  if (!target && !isPersonal) return { ok: false, error: 'That role is not a registered color role in this server.' };
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, error: 'That role no longer exists.' };
  const check = botCanManageRole(member.guild, role);
  if (!check.ok) return { ok: false, error: check.reason };
  // Remove any other color roles first — one color at a time. That includes
  // the personal role when switching to a catalog role, and vice versa.
  const others = colorRoles.map((r) => r.role_id).filter((id) => id !== roleId && member.roles.cache.has(id));
  if (personalId && personalId !== roleId && member.roles.cache.has(personalId)) others.push(personalId);
  if (others.length) await member.roles.remove(others).catch(() => {});
  if (!member.roles.cache.has(roleId)) await member.roles.add(role);
  return { ok: true, role };
}

async function removeMemberColor(member) {
  const colorRoles = await getColorRoles(member.guild.id);
  const mine = colorRoles.map((r) => r.role_id).filter((id) => member.roles.cache.has(id));
  const personalId = await getUserColorRole(member.guild.id, member.id);
  const hadPersonal = personalId && member.roles.cache.has(personalId);
  if (!mine.length && !hadPersonal && !personalId) return { ok: false, error: 'You don\'t have a color role right now.' };
  if (mine.length) await member.roles.remove(mine).catch(() => {});
  // /color remove also deletes the personal color role (1.13.11) — a
  // recolored personal role is not left behind as a dead role.
  let personalDeleted = false;
  if (personalId) {
    if (hadPersonal) await member.roles.remove(personalId).catch(() => {});
    personalDeleted = await removeUserColorRole(member);
  }
  return { ok: true, removed: mine.length, personalDeleted };
}

module.exports = { getColorRoles, addColorRole, removeColorRole, botCanManageRole, setMemberColor, removeMemberColor, getUserColorRole, ensureUserColorRole, removeUserColorRole };
