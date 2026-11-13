// Auto-publish announcements (1.8.7): crosspost messages in configured
// announcement channels as soon as they are posted.
const { Events } = require('discord.js');
const autopublish = require('../utils/autopublish');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await autopublish.handleMessage(message).catch(() => {});
  },
};
