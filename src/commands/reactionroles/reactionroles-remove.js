const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { buildRows } = require('../../utils/reactionRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles-remove')
    .setDescription('Admin only: remove an emoji -> role pair from a reaction-role message.')
    .addStringOption((o) => o.setName('message_id').setDescription('Message ID').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')], ephemeral: true });
    const messageId = interaction.options.getString('message_id');
    const emoji = interaction.options.getString('emoji');
    const res = await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [interaction.guildId, messageId, emoji]);
    if (!res || res.affectedRows === 0) return interaction.reply({ embeds: [errorEmbed('Not found', 'No pair matched that message + emoji.')], ephemeral: true });
    const rows = await db.query('SELECT channel_id FROM reaction_roles WHERE message_id = ? LIMIT 1', [messageId]);
    const channel = rows?.[0] ? await interaction.guild.channels.fetch(rows[0].channel_id).catch(() => null) : null;
    const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (msg) await msg.edit({ components: await buildRows(messageId) }).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Pair removed', `${emoji} was removed from message ${messageId}.`)], ephemeral: true });
  },
};
