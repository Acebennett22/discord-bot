// Temporary voice channels (see src/utils/tempvc.js).
const { Events } = require('discord.js');
const { handleVoiceState } = require('../utils/tempvc');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    await handleVoiceState(oldState, newState).catch(() => {});
  },
};
