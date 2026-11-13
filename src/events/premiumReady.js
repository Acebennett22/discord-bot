// Premium startup: starts the scheduled-messages + reminders loop once
// the client is ready. Separate from ready.js so premium features don't
// touch the core startup path.
const { Events } = require('discord.js');
const { startScheduler } = require('../utils/scheduler');
const { startPresence } = require('../utils/presence');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    startScheduler(client);
    // Rotating Discord presence (global stats as the bot's status).
    startPresence(client);
  },
};
