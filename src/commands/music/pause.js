const { SlashCommandBuilder } = require('discord.js');
const { pause, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current song.'),
  async execute(interaction) {
    if (!(await requireDJ(interaction, 'pause'))) return;
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.playing) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'There is no song playing right now.')], ephemeral: true });
    pause(interaction.guildId);
    return interaction.reply({ ephemeral: true, embeds: [successEmbed('Paused', `Paused **${queue.playing.title}**.`)] });
  },
};
