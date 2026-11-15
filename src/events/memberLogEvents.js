// Member-log event handlers (1.14.2): bans, unbans, timeouts, role
// changes. Joins/leaves are logged from guildMemberAdd/guildMemberRemove
// (kicks are detected there via the audit log). Every handler checks the
// per-event toggle in src/utils/memberLog — nothing posts unless logging
// is set up, and a failure here never breaks the event itself.
const { Events } = require('discord.js');
const { logEvent } = require('../utils/memberLog');

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
      await logEvent(ban.guild, 'bans', '🔨 Member banned',
        `**User:** ${ban.user.tag} (<@${ban.user.id}>)\n**Reason:** ${ban.reason || 'no reason given'}`).catch(() => {});
    },
  },
  {
    name: Events.GuildBanRemove,
    async execute(ban) {
      await logEvent(ban.guild, 'bans', '🔓 Member unbanned',
        `**User:** ${ban.user.tag} (<@${ban.user.id}>)`).catch(() => {});
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
        await logEvent(newMember.guild, 'timeouts', '⏱️ Member timed out',
          `**User:** ${newMember.user.tag} (<@${newMember.id}>)\n**Until:** <t:${Math.floor(until.getTime() / 1000)}:F>`).catch(() => {});
      }
      // Role changes (booster-role syncs also pass through here; that's
      // fine — a role change is a role change).
      const { added, removed } = roleDiff(oldMember, newMember);
      if (added.length || removed.length) {
        const lines = [`**User:** ${newMember.user.tag} (<@${newMember.id}>)`];
        if (added.length) lines.push(`**Added:** ${added.map((r) => `\`${r}\``).join(', ')}`);
        if (removed.length) lines.push(`**Removed:** ${removed.map((r) => `\`${r}\``).join(', ')}`);
        await logEvent(newMember.guild, 'roleChanges', '🎭 Roles changed', lines.join('\n')).catch(() => {});
      }
    },
  },
];
