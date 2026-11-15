const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete a number of recent messages from this channel.')
    .addIntegerOption((o) => o.setName('amount').setDescription('Messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) return interaction.reply({ embeds: [errorEmbed('Clear failed', 'I could not delete those messages (they may be older than 14 days).')] });
    return interaction.reply({ embeds: [successEmbed('Messages cleared', `Deleted **${deleted.size}** message(s).`)] });
  },
};
