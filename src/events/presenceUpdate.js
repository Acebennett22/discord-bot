// Debounced presence updates keep the "Online" stat channel fresh without
// renaming on every single presence change.
const { Events } = require('discord.js');
const { scheduleUpdate } = require('../utils/serverStats');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(_oldPresence, newPresence) {
    if (!newPresence?.guild) return;
    scheduleUpdate(newPresence.guild, 30_000);
  },
};
