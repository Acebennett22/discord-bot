const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { moveToBank, getBalance } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Move coins from your wallet into the bank.')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many coins (leave empty for all)').setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected right now.')], ephemeral: true });
    let amount = interaction.options.getInteger('amount');
    if (!amount) {
      const bal = await getBalance(interaction.guildId, interaction.user.id);
      amount = bal.balance;
    }
    if (!amount || amount <= 0) return interaction.reply({ embeds: [errorEmbed('Nothing to deposit', 'Your wallet is empty.')], ephemeral: true });
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const result = await moveToBank(interaction.guildId, interaction.user.id, amount);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Deposit failed', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Deposited', `🏦 You deposited ${emoji} **${amount} ${name}** into the bank.`)], ephemeral: true });
  },
};
