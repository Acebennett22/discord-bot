const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');
const trading = require('../../utils/trading');

// /trade @user — propose a swap. Both sides must offer something (coins
// and/or an item stack). Flow: proposer posts a PUBLIC proposal in the
// channel -> partner clicks Accept -> proposer clicks Confirm -> the swap
// runs atomically (one DB transaction). 60s expiry, /trade-cancel to back out.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Propose an item/coin trade with another member.')
    .addUserOption((o) => o.setName('user').setDescription('Who to trade with').setRequired(true))
    .addIntegerOption((o) => o.setName('give_coins').setDescription('Coins you give').setMinValue(1))
    .addIntegerOption((o) => o.setName('give_item').setDescription('Shop item ID you give (see /inventory)').setMinValue(1))
    .addIntegerOption((o) => o.setName('give_qty').setDescription('How many of that item (default 1)').setMinValue(1))
    .addIntegerOption((o) => o.setName('get_coins').setDescription('Coins you want from them').setMinValue(1))
    .addIntegerOption((o) => o.setName('get_item').setDescription('Shop item ID you want from them').setMinValue(1))
    .addIntegerOption((o) => o.setName('get_qty').setDescription('How many of that item (default 1)').setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Trading only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Offline', 'The database is not connected, so trading is unavailable right now.')], ephemeral: true });
    const partner = interaction.options.getUser('user');
    if (partner.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('No self-trades', "You can't trade with yourself.")], ephemeral: true });
    if (partner.bot) return interaction.reply({ embeds: [errorEmbed('No bot trades', "You can't trade with a bot.")], ephemeral: true });
    const member = await interaction.guild.members.fetch(partner.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [errorEmbed('Not here', 'That user is not a member of this server.')], ephemeral: true });

    const proposerOffer = {
      coins: interaction.options.getInteger('give_coins') || 0,
      items: interaction.options.getInteger('give_item')
        ? [{ item_id: interaction.options.getInteger('give_item'), quantity: interaction.options.getInteger('give_qty') || 1 }]
        : [],
    };
    const partnerOffer = {
      coins: interaction.options.getInteger('get_coins') || 0,
      items: interaction.options.getInteger('get_item')
        ? [{ item_id: interaction.options.getInteger('get_item'), quantity: interaction.options.getInteger('get_qty') || 1 }]
        : [],
    };
    if (trading.offerIsEmpty(proposerOffer) || trading.offerIsEmpty(partnerOffer)) {
      return interaction.reply({ embeds: [errorEmbed('Empty side', 'A trade needs both sides to offer something — set what you give (give_coins / give_item) AND what you want (get_coins / get_item). Use /pay for one-way coin gifts.')], ephemeral: true });
    }
    // Proposer must own what they offer (checked again atomically at confirm).
    if (proposerOffer.coins > 0) {
      const bal = await inv.getBalance(interaction.guildId, interaction.user.id);
      if (!bal || bal.balance < proposerOffer.coins) return interaction.reply({ embeds: [errorEmbed('Not enough coins', `You only have ${bal?.balance ?? 0} coins in your wallet.`)], ephemeral: true });
    }
    for (const item of proposerOffer.items) {
      const have = await inv.getInventoryQuantity(interaction.guildId, interaction.user.id, item.item_id);
      const row = await inv.getShopItem(interaction.guildId, item.item_id);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Bad item', `No shop item with ID #${item.item_id}.`)], ephemeral: true });
      if (row.type === 'role') return interaction.reply({ embeds: [errorEmbed("Can't trade roles", 'Role items live as Discord roles, not inventory — they can\'t be traded.')], ephemeral: true });
      if (have < item.quantity) return interaction.reply({ embeds: [errorEmbed('Not enough items', `You only have ${have}x ${inv.itemLabel(row)}.`)], ephemeral: true });
    }
    // Partner side: items must exist and be tradeable (ownership re-checked at confirm).
    for (const item of partnerOffer.items) {
      const row = await inv.getShopItem(interaction.guildId, item.item_id);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Bad item', `No shop item with ID #${item.item_id}.`)], ephemeral: true });
      if (row.type === 'role') return interaction.reply({ embeds: [errorEmbed("Can't trade roles", 'Role items live as Discord roles, not inventory — they can\'t be traded.')], ephemeral: true });
    }

    const expiresAt = new Date(Date.now() + 60_000);
    const result = await db.query(
      'INSERT INTO trades (guild_id, proposer_id, partner_id, proposer_offer, partner_offer, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.guildId, interaction.user.id, partner.id, JSON.stringify(proposerOffer), JSON.stringify(partnerOffer), expiresAt],
    );
    if (!result?.insertId) return interaction.reply({ embeds: [errorEmbed('Trade failed', 'Could not create the trade — try again.')], ephemeral: true });
    const tradeId = result.insertId;

    const proposerText = await trading.describeOffer(interaction.guildId, proposerOffer);
    const partnerText = await trading.describeOffer(interaction.guildId, partnerOffer);
    const embed = statsEmbed(
      `🔀 Trade #${tradeId}`,
      `<@${interaction.user.id}> offers: **${proposerText}**\n<@${partner.id}> offers: **${partnerText}**\n\n<@${partner.id}>, click **Accept** to agree — then <@${interaction.user.id}> confirms and the swap happens.\nExpires <t:${Math.floor(expiresAt.getTime() / 1000)}:R> (60s).`,
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`trade:accept:${tradeId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`trade:decline:${tradeId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    );
    // Public by design: the partner has to see the proposal in the channel.
    await interaction.reply({ embeds: [embed], components: [row] });

    // 60s expiry — if still open, mark expired and update the message.
    setTimeout(async () => {
      const rows = await db.query('SELECT status FROM trades WHERE id = ?', [tradeId]);
      const status = rows?.[0]?.status;
      if (status !== 'pending' && status !== 'accepted') return;
      await db.query("UPDATE trades SET status = 'expired' WHERE id = ? AND status IN ('pending', 'accepted')", [tradeId]);
      try {
        await interaction.editReply({ embeds: [statsEmbed(`🔀 Trade #${tradeId} — expired`, 'This trade expired after 60s with no confirmation.')], components: [] });
      } catch {}
    }, 61_000).unref?.();
  },
};
