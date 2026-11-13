const { SlashCommandBuilder } = require('discord.js');
const { resume, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused song.'),
  async execute(interaction) {
    if (!(await requireDJ(interaction))) return;
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.playing) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'There is no song playing right now.')], ephemeral: true });
    resume(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Resumed', `Resumed **${queue.playing.title}**.`)] });
  },
};
