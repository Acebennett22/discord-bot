// Modmail DMs: messages sent to the bot in DMs open/continue a modmail thread.
const { Events } = require('discord.js');
const { relayDmToThread } = require('../utils/modmail');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || message.guild) return;
    if (!message.content.trim()) return;
    await relayDmToThread(message.client, message).catch(() => {});
  },
};
