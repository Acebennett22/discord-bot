const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('invite-reset').setDescription('Admin only: reset invite stats for a user (or everyone).')
    .addBooleanOption((o) => o.setName('confirm').setDescription('You must set this to true to confirm the reset').setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('Member to reset (leave blank to reset everyone in this server)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite stats are stored in MySQL.')] });
    if (!interaction.options.getBoolean('confirm')) {
      return interaction.reply({ embeds: [errorEmbed('Not confirmed', 'Re-run with `confirm: true` to actually reset the invite stats.')] });
    }
    const user = interaction.options.getUser('user');
    if (user) {
      await db.query('DELETE FROM invite_uses WHERE guild_id = ? AND inviter_id = ?', [interaction.guildId, user.id]);
      await db.query('DELETE FROM user_invites WHERE guild_id = ? AND user_id = ?', [interaction.guildId, user.id]);
      return interaction.reply({  embeds: [successEmbed('Invite stats reset', `<@${user.id}>'s invite stats in this server were reset to zero.`)] });
    }
    await db.query('DELETE FROM invite_uses WHERE guild_id = ?', [interaction.guildId]);
    await db.query('DELETE FROM user_invites WHERE guild_id = ?', [interaction.guildId]);
    return interaction.reply({  embeds: [successEmbed('Invite stats reset', 'All invite stats in this server were reset to zero.')] });
  },
};
