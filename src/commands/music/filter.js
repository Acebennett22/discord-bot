const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { getQueue, applyFilter } = require('../../utils/musicQueue');
const { isValidFilter, listFilters } = require('../../utils/musicFilters');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Apply an audio filter to the music (restarts the current track with the filter).')
    .addStringOption((o) => o.setName('name').setDescription('Filter to apply').setRequired(true)
      .addChoices(...listFilters().map((f) => ({ name: f, value: f })))),
  async execute(interaction) {
    if (!(await requireDJ(interaction, 'filter'))) return;
    const name = interaction.options.getString('name');
    if (!isValidFilter(name)) return interaction.reply({ embeds: [errorEmbed('Unknown filter', `Available filters: ${listFilters().join(', ')}.`)], ephemeral: true });
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.playing) {
      return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'Play something with /play first, then apply a filter.')], ephemeral: true });
    }
    applyFilter(interaction.guildId, name);
    return interaction.reply({
      embeds: [successEmbed('Filter applied', name === 'off'
        ? 'Filters off — the current track restarted clean.'
        : `Filter **${name}** on — the current track restarted with the filter applied (filters need re-encoding, so the track starts over).`)],
      ephemeral: true,
    });
  },
};
