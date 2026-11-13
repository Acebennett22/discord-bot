const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modmail-block')
    .setDescription('Staff: block a user from using modmail in this server.')
    .addUserOption((o) => o.setName('user').setDescription('User to block').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(255))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Modmail needs MySQL.')], ephemeral: true });
    const user = interaction.options.getUser('user');
    await db.query(
      'INSERT INTO modmail_blocks (guild_id, user_id, blocked_by, reason) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE blocked_by = VALUES(blocked_by), reason = VALUES(reason)',
      [interaction.guildId, user.id, interaction.user.id, interaction.options.getString('reason') || null],
    );
    return interaction.reply({ embeds: [successEmbed('User blocked', `🚫 **${user.tag}** can no longer use modmail in this server.`)], ephemeral: true });
  },
};
