// /sticky set — save a text as the channel's sticky message and post it at
// the bottom. One sticky per channel; setting a new one replaces the old
// (its message is deleted). Manage Messages only (enforced by the parent
// router via setDefaultMemberPermissions, plus the check below).
// The reply is deferred first, then the sticky is posted, then the reply is
// edited — so the confirmation sits ABOVE the sticky and the sticky ends up
// last in the channel. No ephemeral (1.15.7 keep-list): the defer/edit order
// is what keeps the sticky at the bottom, not a hidden reply.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const sticky = require('../../utils/sticky');

const STICKY_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky-set')
    .setDescription('Set a sticky message that stays at the bottom of a channel.')
    .addStringOption((o) => o.setName('text').setDescription('The sticky message text (plain text, up to 2000 characters)').setRequired(true).setMaxLength(2000))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for the sticky (defaults to this channel)').addChannelTypes(...STICKY_CHANNEL_TYPES))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ embeds: [errorEmbed('Server only', 'Sticky messages can only be set in a server.')] });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ embeds: [errorEmbed('Missing permissions', 'You need the **Manage Messages** permission to set a sticky message.')] });
    }
    if (!db.isEnabled()) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Sticky messages need MySQL — the database is not connected right now.')] });
    }
    const text = interaction.options.getString('text');
    const target = interaction.options.getChannel('channel') || interaction.channel;
    if (!target || !STICKY_CHANNEL_TYPES.includes(target.type)) {
      return interaction.reply({ embeds: [errorEmbed('Text channel only', 'Pick a text or announcement channel — run this command in one, or choose it with the channel option.')] });
    }

    // Defer first so the confirmation reply is created BEFORE the sticky
    // post; the sticky then lands below it, at the bottom of the channel.
    await interaction.deferReply();
    // Capture the old message id NOW: the row object may be mutated by the
    // upsert below (same object in some DB layers), so compare against this
    // snapshot, not existing.message_id after saving.
    const existing = await sticky.getSticky(interaction.guildId, target.id).catch(() => null);
    const oldMessageId = existing?.message_id || null;

    let sent;
    try {
      sent = await target.send({ content: text });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Could not post the sticky', `I could not send a message in ${target} — check I have permission to send messages there. (${err.message})`)] });
    }
    const saved = await sticky.setStickyRow({ guildId: interaction.guildId, channelId: target.id, messageId: sent.id, content: text, userId: interaction.user.id });
    if (!saved) {
      await sent.delete().catch(() => {});
      return interaction.editReply({ embeds: [errorEmbed('Could not save the sticky', 'The sticky message was posted but could not be saved to the database, so it was removed — try again.')] });
    }
    // Replace the old sticky message now that the new row is stored.
    if (oldMessageId && oldMessageId !== sent.id) await sticky.deleteStickyMessage(target, oldMessageId);

    return interaction.editReply({ embeds: [successEmbed('📌 Sticky set', `This message will stay at the bottom of ${target}.${existing ? '\nThe previous sticky was removed.' : ''}`)] });
  },
};
