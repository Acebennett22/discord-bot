const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { buildRows } = require('../../utils/reactionRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles-add')
    .setDescription('Admin only: add an emoji -> role pair to a reaction-role message.')
    .addStringOption((o) => o.setName('message_id').setDescription('Message ID of the reaction-role message').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji (unicode or custom)').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
    .addRoleOption((o) => o.setName('required_role').setDescription('Optional: member must already have this role'))
    .addIntegerOption((o) => o.setName('min_days').setDescription('Optional: member must have been in the server at least this many days').setMinValue(0).setMaxValue(3650))
    .addIntegerOption((o) => o.setName('min_level').setDescription('Optional: member must be at least this leveling level').setMinValue(0).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')], ephemeral: true });
    const messageId = interaction.options.getString('message_id');
    const emoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');
    const requiredRole = interaction.options.getRole('required_role');
    const minDays = interaction.options.getInteger('min_days');
    const minLevel = interaction.options.getInteger('min_level');
    const rows = await db.query('SELECT channel_id FROM reaction_roles WHERE message_id = ? LIMIT 1', [messageId]);
    const channelId = rows?.[0]?.channel_id || interaction.channelId;
    await db.query(
      'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id, required_role_id, min_days_in_server, min_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), required_role_id = VALUES(required_role_id), min_days_in_server = VALUES(min_days_in_server), min_level = VALUES(min_level)',
      [interaction.guildId, channelId, messageId, emoji, role.id, requiredRole?.id || null, minDays ?? null, minLevel ?? null],
    );
    const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (msg) await msg.edit({ components: await buildRows(messageId) }).catch(() => {});
    const reqs = [
      requiredRole ? `requires <@&${requiredRole.id}>` : null,
      minDays !== null && minDays !== undefined ? `requires ${minDays}+ days in server` : null,
      minLevel !== null && minLevel !== undefined ? `requires level ${minLevel}+` : null,
    ].filter(Boolean).join(', ');
    return interaction.reply({ embeds: [successEmbed('Pair added', `${emoji} → **${role.name}** on message ${messageId}.${reqs ? `\nRequirements: ${reqs}.` : ''}`)], ephemeral: true });
  },
};
