// Snipe event hooks (1.7.7): capture deletes/edits into the in-memory store.
// Message content is fetched via partials; the bot needs the Message Content
// intent for full text (otherwise content may be empty).
const { Events } = require('discord.js');
const snipe = require('../utils/snipe');

module.exports = [
  {
    name: Events.MessageDelete,
    async execute(message) {
      if (message.partial) await message.fetch().catch(() => null);
      snipe.recordDelete(message);
    },
  },
  {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
      if (oldMessage.partial) await oldMessage.fetch().catch(() => null);
      if (newMessage.partial) await newMessage.fetch().catch(() => null);
      snipe.recordEdit(oldMessage, newMessage);
    },
  },
];
