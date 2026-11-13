// Voice XP session tracking (1.4.3). Runs alongside the tempvc
// VoiceStateUpdate handler — discord.js calls every registered handler.
const { Events } = require('discord.js');
const { handleVoiceState } = require('../utils/voiceXp');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    await handleVoiceState(oldState, newState).catch(() => {});
  },
};
