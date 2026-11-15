const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { resetCount } = require('../../utils/counting');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting-reset')
    .setDescription('Admin only: reset the counting game back to 0.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!(await resetCount(interaction.guildId))) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Counting needs MySQL.')] });
    }
    return interaction.reply({ embeds: [successEmbed('Counting reset', 'The count is back to **0** — next number is 1.')] });
  },
};
