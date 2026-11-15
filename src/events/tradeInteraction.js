// Button handler for /trade proposals: partner Accept/Decline, then
// proposer Confirm/Cancel. The swap itself runs in one DB transaction
// (src/utils/trading.js executeTrade) so it is all-or-nothing.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, statsEmbed, successEmbed } = require('../utils/embeds');
const db = require('../utils/database');
const trading = require('../utils/trading');

async function getTrade(id) {
  const rows = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
  return rows?.[0] || null;
}

function tradeEmbed(trade, proposerText, partnerText, note) {
  return statsEmbed(
    `🔀 Trade #${trade.id}`,
    `<@${trade.proposer_id}> offers: **${proposerText}**\n<@${trade.partner_id}> offers: **${partnerText}**\n\n${note}`,
  );
}

module.exports = {
  name: 'tradeInteraction',
  once: false,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('trade:')) return;
    const [, action, tradeIdStr] = interaction.customId.split(':');
    const tradeId = parseInt(tradeIdStr, 10);
    const trade = await getTrade(tradeId);
    if (!trade) return interaction.reply({ embeds: [errorEmbed('Trade not found', 'This trade no longer exists.')] });
    if (trade.status === 'completed') return interaction.reply({ embeds: [errorEmbed('Already completed', 'This trade already went through.')] });
    if (trade.status === 'cancelled') return interaction.reply({ embeds: [errorEmbed('Cancelled', 'This trade was cancelled.')] });
    if (trade.status === 'expired') return interaction.reply({ embeds: [errorEmbed('Expired', 'This trade expired.')] });

    const proposerText = await trading.describeOffer(trade.guild_id, trade.proposer_offer);
    const partnerText = await trading.describeOffer(trade.guild_id, trade.partner_offer);

    if (action === 'decline') {
      if (interaction.user.id !== trade.partner_id && interaction.user.id !== trade.proposer_id) {
        return interaction.reply({ embeds: [errorEmbed('Not your trade', 'Only the proposer or the partner can decline this trade.')] });
      }
      await db.query("UPDATE trades SET status = 'cancelled' WHERE id = ?", [trade.id]);
      return interaction.update({ embeds: [tradeEmbed(trade, proposerText, partnerText, '❌ Trade declined/cancelled — nothing was swapped.')], components: [] });
    }

    if (action === 'accept') {
      if (trade.status !== 'pending') return interaction.reply({ embeds: [errorEmbed('Wrong step', 'This trade is no longer waiting for acceptance.')] });
      if (interaction.user.id !== trade.partner_id) {
        return interaction.reply({ embeds: [errorEmbed('Not your trade', 'Only the trade partner can accept this proposal.')] });
      }
      await db.query("UPDATE trades SET status = 'accepted' WHERE id = ?", [trade.id]);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`trade:confirm:${trade.id}`).setLabel('Confirm swap').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`trade:cancel:${trade.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
      );
      return interaction.update({ embeds: [tradeEmbed(trade, proposerText, partnerText, `✅ <@${trade.partner_id}> accepted! <@${trade.proposer_id}>, click **Confirm swap** to complete the trade.`)], components: [row] });
    }

    if (action === 'cancel') {
      if (interaction.user.id !== trade.proposer_id && interaction.user.id !== trade.partner_id) {
        return interaction.reply({ embeds: [errorEmbed('Not your trade', 'Only the proposer or the partner can cancel this trade.')] });
      }
      await db.query("UPDATE trades SET status = 'cancelled' WHERE id = ?", [trade.id]);
      return interaction.update({ embeds: [tradeEmbed(trade, proposerText, partnerText, '❌ Trade cancelled — nothing was swapped.')], components: [] });
    }

    if (action === 'confirm') {
      if (trade.status !== 'accepted') return interaction.reply({ embeds: [errorEmbed('Wrong step', 'The partner has to accept first.')] });
      if (interaction.user.id !== trade.proposer_id) {
        return interaction.reply({ embeds: [errorEmbed('Not your trade', 'Only the proposer can confirm the swap.')] });
      }
      const fresh = await getTrade(trade.id);
      const res = await trading.executeTrade(fresh);
      if (!res.ok) {
        await db.query("UPDATE trades SET status = 'cancelled' WHERE id = ?", [trade.id]);
        return interaction.update({ embeds: [tradeEmbed(trade, proposerText, partnerText, `❌ Trade failed: ${res.error} Nothing was swapped.`)], components: [] });
      }
      return interaction.update({ embeds: [successEmbed(`🔀 Trade #${trade.id} complete!`, `<@${trade.proposer_id}> gave **${proposerText}** and received **${partnerText}**.\n<@${trade.partner_id}> gave **${partnerText}** and received **${proposerText}**.`)], components: [] });
    }
  },
};
