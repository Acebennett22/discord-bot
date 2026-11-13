const { Events } = require('discord.js');
const db = require('../utils/database');
const { scheduleUpdate } = require('../utils/serverStats');
const { sendWelcome } = require('../utils/welcome');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // Welcome message from per-guild settings (channel + template + toggle).
    // Unset channel or disabled = no message. Failures are logged, never fatal.
    await sendWelcome(member).catch(() => {});
    await db.incrementMembersJoined(member.guild.id);
    scheduleUpdate(member.guild);
  },
};
