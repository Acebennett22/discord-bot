// Debounced presence updates keep the "Online" stat channel fresh without
// renaming on every single presence change.
const { Events } = require('discord.js');
const { scheduleUpdate } = require('../utils/serverStats');
const { applyStatusRoles } = require('../utils/statusRoles');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(_oldPresence, newPresence) {
    if (!newPresence?.guild) return;
    scheduleUpdate(newPresence.guild, 30_000);
    // Custom status roles (1.7.6): grant/remove roles when a member's custom
    // status gains or loses a trigger text. Presence updates can be missed,
    // so a 10-minute sweep (startStatusRoleSweep) catches stragglers.
    if (newPresence.member) await applyStatusRoles(newPresence.member).catch(() => {});
  },
};
