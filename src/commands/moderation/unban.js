const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their Discord user ID.')
    .addStringOption((o) => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the unban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction) {
    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const banned = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!banned) return interaction.reply({ embeds: [errorEmbed('Unban failed', 'That user ID is not on this server\'s ban list.')] });
    await interaction.guild.members.unban(userId, reason);
    return interaction.reply({  embeds: [successEmbed('User unbanned', `**${banned.user.tag}** was unbanned.\nReason: ${reason}`)] });
  },
};
