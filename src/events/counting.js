// Counting game messages (see src/utils/counting.js for the rules).
const { Events } = require('discord.js');
const { handleCountingMessage } = require('../utils/counting');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await handleCountingMessage(message).catch(() => {});
  },
};
