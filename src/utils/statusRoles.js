// Custom status roles (1.7.6): if a member's custom Discord status contains
// a configured trigger text (case-insensitive), they get the role; when the
// status no longer contains it (or is cleared), the role is removed.
// Honest limit: custom statuses only update when Discord sends presence
// updates, so there can be a delay — a 10-minute sweep catches missed ones.
const db = require('./database');
const errorLogger = require('./errorLogger');

async function getStatusRoles(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM status_roles WHERE guild_id = ?', [guildId])) || [];
}

async function addStatusRole(guildId, triggerText, roleId, createdBy) {
  await db.query(
    'INSERT INTO status_roles (guild_id, trigger_text, role_id, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)',
    [guildId, triggerText.toLowerCase(), roleId, createdBy],
  );
}

async function removeStatusRole(guildId, triggerText) {
  const res = await db.query('DELETE FROM status_roles WHERE guild_id = ? AND trigger_text = ?', [guildId, triggerText.toLowerCase()]);
  return (res?.affectedRows || 0) > 0;
}

function customStatusText(member) {
  const activity = member.presence?.activities?.find((a) => a.type === 4); // Custom status
  return (activity?.state || '').toLowerCase();
}

async function applyStatusRoles(member) {
  if (!member?.guild || member.user.bot) return;
  const rules = await getStatusRoles(member.guild.id);
  if (!rules.length) return;
  const status = customStatusText(member);
  const botHighest = member.guild.members.me?.roles.highest;
  for (const rule of rules) {
    const role = member.guild.roles.cache.get(rule.role_id);
    if (!role) continue;
    if (botHighest && role.position >= botHighest.position) continue; // hierarchy guard
    const shouldHave = status.includes(rule.trigger_text.toLowerCase());
    const has = member.roles.cache.has(role.id);
    if (shouldHave && !has) await member.roles.add(role, 'Custom status role').catch(() => {});
    else if (!shouldHave && has) await member.roles.remove(role, 'Custom status no longer matches').catch(() => {});
  }
}

async function sweepStatusRoles(client) {
  if (!db.isEnabled()) return;
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    try {
      const rules = await getStatusRoles(guild.id);
      if (!rules.length) continue;
      const members = await guild.members.fetch().catch(() => null);
      if (!members) continue;
      for (const member of members.values()) {
        await applyStatusRoles(member).catch(() => {});
      }
    } catch (e) {
      errorLogger.log({ level: 'error', guildId: guild.id, commandName: 'statusrole', message: `Status role sweep failed: ${e.message}`, stack: e.stack });
    }
  }
}

function startStatusRoleSweep(client) {
  setInterval(() => sweepStatusRoles(client), 10 * 60_000);
}

module.exports = { getStatusRoles, addStatusRole, removeStatusRole, customStatusText, applyStatusRoles, sweepStatusRoles, startStatusRoleSweep };
