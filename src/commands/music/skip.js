const { SlashCommandBuilder } = require('discord.js');
const { skip, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current song.'),
  async execute(interaction) {
    if (!(await requireDJ(interaction))) return;
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.playing) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'There is no song playing right now.')], ephemeral: true });
    const title = queue.playing.title;
    skip(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Skipped', `Skipped **${title}**.`)] });
  },
};
