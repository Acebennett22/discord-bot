const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { getBumpSettings, recordBump, msUntilNextBump, formatDuration } = require('../../utils/bump');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump')
    .setDescription('Show the bump timer, or record a manual bump.')
    .addBooleanOption((o) => o.setName('record').setDescription('Record a bump right now (use after bumping on DISBOARD)')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bump tracking needs MySQL.')] });
    if (interaction.options.getBoolean('record')) {
      await recordBump(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('Bump recorded', 'Thanks! The next bump reminder is in **2 hours**.')] });
    }
    const settings = await getBumpSettings(interaction.guildId);
    if (!settings?.last_bump_at) {
      return interaction.reply({ embeds: [successEmbed('Bump timer', 'No bump has been recorded yet. Bump with `!d bump` on DISBOARD, then use `/bump record` if it is not picked up automatically.')] });
    }
    const remaining = msUntilNextBump(settings.last_bump_at);
    if (remaining <= 0) {
      return interaction.reply({ embeds: [successEmbed('Bump timer', '⏰ **It is time to bump!** Run `!d bump` now.')] });
    }
    return interaction.reply({ embeds: [successEmbed('Bump timer', `Next bump in **${formatDuration(remaining)}**.`)] });
  },
};
