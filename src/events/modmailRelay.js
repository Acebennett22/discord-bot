// Staff replies inside a modmail thread channel are relayed to the user's DM.
const { Events } = require('discord.js');
const { relayThreadToDm } = require('../utils/modmail');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (!message.content.trim()) return;
    await relayThreadToDm(message.client, message).catch(() => {});
  },
};
