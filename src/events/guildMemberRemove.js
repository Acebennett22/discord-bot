const { Events } = require('discord.js');
const { scheduleUpdate } = require('../utils/serverStats');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    scheduleUpdate(member.guild);
  },
};
