// AFK voice tracking (1.7.4): feed voice state changes into the idle tracker.
const { Events } = require('discord.js');
const { handleVoiceState } = require('../utils/afkVoice');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    await handleVoiceState(oldState, newState).catch(() => {});
  },
};
