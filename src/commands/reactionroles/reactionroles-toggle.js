// Reaction-role toggle (1.14.1): pause or resume all role buttons on one
// reaction-role message without deleting its mappings. While paused the
// buttons render disabled and stale clicks are refused, so nobody can
// pick up (or drop) roles until an admin turns it back on.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { buildRows } = require('../../utils/reactionRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles-toggle')
    .setDescription('Admin only: pause or resume the role buttons on a reaction-role message.')
    .addStringOption((o) => o.setName('message_id').setDescription('ID of the reaction-role message').setRequired(true).setMaxLength(32))
    .addBooleanOption((o) => o.setName('enabled').setDescription('true = buttons work, false = paused').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Reaction roles only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Administrator permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')] });
    const messageId = interaction.options.getString('message_id').trim();
    const enabled = interaction.options.getBoolean('enabled');
    const rows = await db.query(
      'SELECT channel_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ?',
      [interaction.guildId, messageId],
    );
    if (!rows?.length) {
      return interaction.reply({ embeds: [errorEmbed('Not a reaction-role message', `No reaction-role mappings found for message **${messageId}** in this server. Use the message ID from /reactionroles-setup or /reactionroles-list.`)] });
    }
    await db.query(
      'UPDATE reaction_roles SET enabled = ? WHERE guild_id = ? AND message_id = ?',
      [enabled ? 1 : 0, interaction.guildId, messageId],
    );
    // Re-render the buttons so they show enabled/disabled immediately.
    const channel = interaction.guild.channels.cache.get(rows[0].channel_id)
      || await interaction.guild.channels.fetch(rows[0].channel_id).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (message) {
      await message.edit({ components: await buildRows(messageId) }).catch(() => {});
    }
    const pairs = rows.map((r) => `${r.emoji} → <@&${r.role_id}>`).join('\n');
    return interaction.reply({ embeds: [successEmbed(
      enabled ? 'Reaction roles resumed' : 'Reaction roles paused',
      `${rows.length} mapping(s) on message **${messageId}** are now ${enabled ? '✅ live — buttons work again' : '⏸️ paused — buttons are disabled'}.\n${pairs}${message ? '' : '\n\n⚠️ Could not find the message to re-render its buttons — it may have been deleted. The setting still applies if it comes back.'}`,
    )] });
  },
};
