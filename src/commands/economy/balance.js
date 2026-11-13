const { SlashCommandBuilder } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getBalance } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your coin balance (wallet + bank).')
    .addUserOption((o) => o.setName('user').setDescription('Check someone else\'s balance')),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so balances are unavailable right now.')], ephemeral: true });
    const target = interaction.options.getUser('user') || interaction.user;
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const bal = await getBalance(interaction.guildId, target.id);
    return interaction.reply({ embeds: [statsEmbed(
      `${target.username}'s balance`,
      `${emoji} **Wallet:** ${bal.balance} ${name}\n🏦 **Bank:** ${bal.bank} ${name}\n💰 **Total:** ${bal.balance + bal.bank} ${name}`,
    )], ephemeral: true });
  },
};
