const { Events } = require('discord.js');
const { scheduleUpdate } = require('../utils/serverStats');
const { sendGoodbye } = require('../utils/welcome');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    // Goodbye message from per-guild settings (channel + template + toggle).
    await sendGoodbye(member).catch(() => {});
    scheduleUpdate(member.guild);
  },
};
