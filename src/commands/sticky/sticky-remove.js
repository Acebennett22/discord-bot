// /sticky remove — delete the sticky message and its stored row for a
// channel. Manage Messages only (enforced by the parent router via
// setDefaultMemberPermissions, plus the check below). No sticky in the
// channel is an informational reply, not an error.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const sticky = require('../../utils/sticky');

const STICKY_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky-remove')
    .setDescription('Remove the sticky message from a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to remove the sticky from (defaults to this channel)').addChannelTypes(...STICKY_CHANNEL_TYPES))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ embeds: [errorEmbed('Server only', 'Sticky messages can only be removed in a server.')] });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ embeds: [errorEmbed('Missing permissions', 'You need the **Manage Messages** permission to remove a sticky message.')] });
    }
    if (!db.isEnabled()) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Sticky messages need MySQL — the database is not connected right now.')] });
    }
    const target = interaction.options.getChannel('channel') || interaction.channel;
    if (!target || !STICKY_CHANNEL_TYPES.includes(target.type)) {
      return interaction.reply({ embeds: [errorEmbed('Text channel only', 'Pick a text or announcement channel — run this command in one, or choose it with the channel option.')] });
    }
    const existing = await sticky.getSticky(interaction.guildId, target.id).catch(() => null);
    if (!existing) {
      return interaction.reply({ embeds: [infoEmbed('No sticky here', `There is no sticky message in ${target}.`)] });
    }
    await sticky.deleteStickyMessage(target, existing.message_id);
    await sticky.removeStickyRow(interaction.guildId, target.id);
    return interaction.reply({ embeds: [successEmbed('📌 Sticky removed', `The sticky message was removed from ${target}.`)] });
  },
};
