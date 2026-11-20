// Member-log event handlers (1.14.2): bans, unbans, timeouts, role
// changes. Joins/leaves are logged from guildMemberAdd/guildMemberRemove
// (kicks are detected there via the audit log). Every handler checks the
// per-event toggle in src/utils/memberLog — nothing posts unless logging
// is set up, and a failure here never breaks the event itself.
// (1.16.1) Bans, unbans, timeouts, and role changes now name the
// moderator, like Discord's audit log: the executor is resolved from the
// guild audit log, falling back to 'unknown' when it can't be resolved.
// (1.16.4) The resolver lives in src/utils/resolveActor.js now (shared
// with the message-delete log) and retries once after ~1.5s, because the
// gateway event can fire before Discord has written the audit entry —
// that race is why the bot's own autorole once logged "By: unknown".
const { Events, AuditLogEvent } = require('discord.js');
const { logEvent } = require('../utils/memberLog');
const { resolveActor } = require('../utils/resolveActor');

function roleDiff(oldMember, newMember) {
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());
  const added = [...newRoles].filter((id) => !oldRoles.has(id)).map((id) => newMember.roles.cache.get(id)?.name || id);
  const removed = [...oldRoles].filter((id) => !newRoles.has(id)).map((id) => oldMember.roles.cache.get(id)?.name || id);
  return { added, removed };
}

module.exports = [
  {
    name: Events.GuildBanAdd,
    async execute(ban) {
      const by = await resolveActor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      await logEvent(ban.guild, 'bans', '🔨 Member banned',
        `**User:** ${ban.user.tag} (<@${ban.user.id}>)\n**By:** ${by}\n**Reason:** ${ban.reason || 'no reason given'}`).catch(() => {});
    },
  },
  {
    name: Events.GuildBanRemove,
    async execute(ban) {
      const by = await resolveActor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      await logEvent(ban.guild, 'bans', '🔓 Member unbanned',
        `**User:** ${ban.user.tag} (<@${ban.user.id}>)\n**By:** ${by}`).catch(() => {});
    },
  },
  {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
      if (newMember.user.bot) return;
      // Timeout: communicationDisabledUntil moved from null -> set (timed
      // out) or set -> null/expired (timeout ended). Only log new timeouts.
      const wasTimedOut = Boolean(oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > Date.now());
      const isTimedOut = Boolean(newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > Date.now());
      if (!wasTimedOut && isTimedOut) {
        const until = newMember.communicationDisabledUntil;
        const by = await resolveActor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        await logEvent(newMember.guild, 'timeouts', '⏱️ Member timed out',
          `**User:** ${newMember.user.tag} (<@${newMember.id}>)\n**By:** ${by}\n**Until:** <t:${Math.floor(until.getTime() / 1000)}:F>`).catch(() => {});
      }
      // Role changes (booster-role syncs also pass through here; that's
      // fine — a role change is a role change).
      const { added, removed } = roleDiff(oldMember, newMember);
      if (added.length || removed.length) {
        const by = await resolveActor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        const lines = [`**User:** ${newMember.user.tag} (<@${newMember.id}>)`, `**By:** ${by}`];
        if (added.length) lines.push(`**Added:** ${added.map((r) => `\`${r}\``).join(', ')}`);
        if (removed.length) lines.push(`**Removed:** ${removed.map((r) => `\`${r}\``).join(', ')}`);
        await logEvent(newMember.guild, 'roleChanges', '🎭 Roles changed', lines.join('\n')).catch(() => {});
      }
    },
  },
];
