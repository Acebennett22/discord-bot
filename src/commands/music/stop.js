const { SlashCommandBuilder } = require('discord.js');
const { stop, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback, clear the queue, and leave voice.'),
  async execute(interaction) {
    if (!(await requireDJ(interaction))) return;
    if (!getQueue(interaction.guildId)) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'There is no music playing right now.')], ephemeral: true });
    stop(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Stopped', 'Playback stopped, queue cleared, and I left the voice channel.')] });
  },
};
