const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { closeThread } = require('../../utils/modmail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modmail-close')
    .setDescription('Staff: close this modmail thread.')
    .addStringOption((o) => o.setName('reason').setDescription('Reason for closing').setRequired(false).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Modmail needs MySQL.')], flags: MessageFlags.Ephemeral });
    const rows = await db.query("SELECT * FROM modmail_threads WHERE channel_id = ? AND status = 'open'", [interaction.channelId]);
    const thread = rows?.[0];
    if (!thread) return interaction.reply({ embeds: [errorEmbed('Not a modmail thread', 'This channel is not an open modmail thread.')], flags: MessageFlags.Ephemeral });
    await closeThread(interaction.client, interaction.guild, thread, interaction.user, interaction.options.getString('reason'));
    return interaction.reply({ embeds: [successEmbed('Thread closed', 'The user has been DM\'d and this channel will be deleted shortly.')], flags: MessageFlags.Ephemeral });
  },
};
