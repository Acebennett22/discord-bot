// /voicetime — same stats as /voicexp, under the name the voice-stats
// docs use. (A separate command file because SlashCommandBuilder mutates
// in place — sharing one builder would rename both commands.)
const { SlashCommandBuilder } = require('discord.js');
const voicexp = require('./voicexp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voicetime')
    .setDescription('Show voice time and voice XP earned.')
    .addUserOption((o) => o.setName('user').setDescription('Whose voice stats to show (default: you)')),
  execute: voicexp.execute,
};
