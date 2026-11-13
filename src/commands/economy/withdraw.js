const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { moveFromBank, getBalance } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Move coins from the bank into your wallet.')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many coins (leave empty for all)').setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected right now.')], ephemeral: true });
    let amount = interaction.options.getInteger('amount');
    if (!amount) {
      const bal = await getBalance(interaction.guildId, interaction.user.id);
      amount = bal.bank;
    }
    if (!amount || amount <= 0) return interaction.reply({ embeds: [errorEmbed('Nothing to withdraw', 'Your bank balance is empty.')], ephemeral: true });
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const result = await moveFromBank(interaction.guildId, interaction.user.id, amount);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Withdrawal failed', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Withdrawn', `🏦 You withdrew ${emoji} **${amount} ${name}** from the bank.`)], ephemeral: true });
  },
};
