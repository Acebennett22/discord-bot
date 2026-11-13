// XP awarding on messages (leveling) + Automod checks — bots and DMs ignored.
// Automod runs first: a message it deletes doesn't earn XP.
const { Events } = require('discord.js');
const { awardXp } = require('../utils/leveling');
const automod = require('../utils/automod');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    const actioned = await automod.handleMessage(message).catch(() => null);
    if (actioned?.deleted) return;
    await awardXp(message).catch(() => {});
  },
};
