const { Events } = require('discord.js');
const db = require('../utils/database');
const { scheduleUpdate } = require('../utils/serverStats');
const { sendWelcome } = require('../utils/welcome');
const { sendWelcomeDm } = require('../utils/welcomeDm');
const { onMemberJoin } = require('../utils/verification');
const { checkMilestones } = require('../utils/milestones');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // Verification gate: DM the newcomer where to verify (never fatal).
    await onMemberJoin(member).catch(() => {});
    // Welcome message from per-guild settings (channel + template + toggle).
    // Unset channel or disabled = no message. Failures are logged, never fatal.
    await sendWelcome(member).catch(() => {});
    // Welcome DM (1.9.3): private welcome, skipped silently if DMs closed.
    await sendWelcomeDm(member).catch(() => {});
    // Member milestones (1.10.4): round member counts get a celebration +
    // a coin bonus for the member who triggers one.
    const previousCount = Math.max(0, member.guild.memberCount - 1);
    await checkMilestones(member, previousCount, member.guild.memberCount).catch(() => {});
    await db.incrementMembersJoined(member.guild.id);
    scheduleUpdate(member.guild);
  },
};
