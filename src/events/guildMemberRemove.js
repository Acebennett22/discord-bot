const { Events, AuditLogEvent } = require('discord.js');
const { scheduleUpdate } = require('../utils/serverStats');
const { sendGoodbye } = require('../utils/welcome');
const { logEvent } = require('../utils/memberLog');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    // Goodbye message from per-guild settings (channel + template + toggle).
    await sendGoodbye(member).catch(() => {});
    // Member logging (1.14.2): a kick shows up in the audit log, so check
    // for a recent MEMBER_KICK entry for this user — if there is one, log
    // it as a kick (and skip the plain "left" line); otherwise log a leave.
    // Needs View Audit Log; without it every removal logs as a leave.
    try {
      let kick = null;
      if (member.guild.members.me?.permissions?.has('ViewAuditLog')) {
        const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 3 });
        kick = logs.entries.find((e) => e.target?.id === member.id && Date.now() - e.createdAt.getTime() < 10_000);
      }
      if (kick) {
        await logEvent(member.guild, 'kicks', '👢 Member kicked',
          `**User:** ${member.user.tag} (<@${member.id}>)\n**By:** ${kick.executor ? `${kick.executor.tag} (<@${kick.executor.id}>)` : 'unknown'}\n**Reason:** ${kick.reason || 'no reason given'}`);
      } else {
        await logEvent(member.guild, 'leaves', '🚪 Member left',
          `**User:** ${member.user.tag} (<@${member.id}>)\n**Members now:** ${member.guild.memberCount}`);
      }
    } catch {}
    scheduleUpdate(member.guild);
  },
};
