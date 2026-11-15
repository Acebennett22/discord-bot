const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { transfer } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Pay coins to another member.')
    .addUserOption((o) => o.setName('user').setDescription('Who to pay').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many coins').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so payments are unavailable right now.')] });
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (target.id === interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Nice try', 'You can\'t pay yourself.')] });
    }
    if (target.bot) {
      return interaction.reply({ embeds: [errorEmbed('Nope', 'Bots don\'t need coins.')] });
    }
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const result = await transfer(interaction.guildId, interaction.user.id, target.id, amount);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Payment failed', result.error)] });
    return interaction.reply({ embeds: [successEmbed('Payment sent', `${emoji} You paid **${amount} ${name}** to ${target}.` )] });
  },
};
