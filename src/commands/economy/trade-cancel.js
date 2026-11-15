const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trade-cancel')
    .setDescription('Cancel one of your open trades.')
    .addIntegerOption((o) => o.setName('trade_id').setDescription('Trade # to cancel (default: your most recent open trade)').setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Trading only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Offline', 'The database is not connected.')] });
    const tradeId = interaction.options.getInteger('trade_id');
    let rows;
    if (tradeId) {
      rows = await db.query("SELECT * FROM trades WHERE id = ? AND guild_id = ? AND status IN ('pending', 'accepted')", [tradeId, interaction.guildId]);
    } else {
      rows = await db.query(
        "SELECT * FROM trades WHERE guild_id = ? AND (proposer_id = ? OR partner_id = ?) AND status IN ('pending', 'accepted') ORDER BY id DESC LIMIT 1",
        [interaction.guildId, interaction.user.id, interaction.user.id],
      );
    }
    const trade = rows?.[0];
    if (!trade) return interaction.reply({ embeds: [errorEmbed('No open trade', tradeId ? `Trade #${tradeId} is not open (or doesn't exist).` : 'You have no open trades to cancel.')] });
    if (trade.proposer_id !== interaction.user.id && trade.partner_id !== interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Not your trade', "Only the proposer or the partner can cancel this trade.")] });
    }
    await db.query("UPDATE trades SET status = 'cancelled' WHERE id = ?", [trade.id]);
    return interaction.reply({ embeds: [successEmbed('Trade cancelled', `Trade #${trade.id} has been cancelled. Nothing was swapped.`)] });
  },
};
