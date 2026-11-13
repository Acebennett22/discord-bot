// Nitro booster role (1.12.2): grant a configured role when a member
// starts boosting, remove it when they stop. Role must sit below the bot's
// highest role; grant/remove failures are logged, never fatal.
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const errorLogger = require('./errorLogger');

function roleAssignable(guild, roleId) {
  if (!roleId) return false;
  const role = guild.roles.cache.get(roleId);
  if (!role) return false;
  const botMember = guild.members.me;
  if (!botMember) return false;
  return role.position < botMember.roles.highest.position;
}

async function syncBoosterRole(member, wasBoosting, isBoosting) {
  const settings = await getGuildSettings(member.guild.id).catch(() => null);
  const roleId = settings?.boosterRoleId;
  if (!roleId) return;
  if (wasBoosting === isBoosting) return;
  const guild = member.guild;
  if (!roleAssignable(guild, roleId)) {
    errorLogger.log({ level: 'warn', guildId: guild.id, commandName: 'boosterrole', message: `Booster role ${roleId} is not assignable (missing or above the bot's highest role).` });
    return;
  }
  try {
    if (isBoosting) await member.roles.add(roleId, 'Started Nitro boosting');
    else await member.roles.remove(roleId, 'Stopped Nitro boosting');
  } catch (err) {
    errorLogger.log({ level: 'error', guildId: guild.id, commandName: 'boosterrole', message: `Failed to ${isBoosting ? 'grant' : 'remove'} booster role: ${err.message}`, stack: err.stack });
  }
}

// One-time sweep: grant the booster role to everyone currently boosting.
async function sweepBoosters(guild) {
  const settings = await getGuildSettings(guild.id).catch(() => null);
  const roleId = settings?.boosterRoleId;
  if (!roleId) return { granted: 0, error: 'No booster role is configured.' };
  if (!roleAssignable(guild, roleId)) return { granted: 0, error: 'That role is missing or above my highest role — I cannot assign it.' };
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return { granted: 0, error: 'Could not fetch the member list.' };
  let granted = 0;
  for (const m of members.values()) {
    if (m.premiumSince && !m.roles.cache.has(roleId)) {
      try { await m.roles.add(roleId, 'Booster role sweep'); granted++; } catch {}
    }
  }
  return { granted };
}

module.exports = { roleAssignable, syncBoosterRole, sweepBoosters };
