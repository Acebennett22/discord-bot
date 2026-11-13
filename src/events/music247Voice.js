// 24/7 music mode (1.12.1): if the bot itself is disconnected/kicked from
// a voice channel while 24/7 is on, rejoin it.
const { Events } = require('discord.js');
const { handleBotVoiceLeave } = require('../utils/music247');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    if (oldState.member?.id !== oldState.client.user.id) return;
    if (newState.channelId) return; // still connected somewhere
    if (!oldState.channelId) return;
    await handleBotVoiceLeave(client, oldState).catch(() => {});
  },
};
