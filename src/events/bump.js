// Bump tracking: record DISBOARD bumps (or !d bump) so the reminder
// checker knows when 2 hours have passed.
const { Events } = require('discord.js');
const { handleBumpMessage } = require('../utils/bump');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await handleBumpMessage(message).catch(() => {});
  },
};
