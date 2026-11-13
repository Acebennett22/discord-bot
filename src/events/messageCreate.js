// XP awarding on messages (leveling) — bots and DMs are ignored.
const { Events } = require('discord.js');
const { awardXp } = require('../utils/leveling');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    await awardXp(message).catch(() => {});
  },
};
