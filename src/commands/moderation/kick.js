const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [errorEmbed('Kick failed', 'That user is not in this server.')], ephemeral: true });
    if (!member.kickable) return interaction.reply({ embeds: [errorEmbed('Kick failed', 'I cannot kick that member — check my role position and permissions.')], ephemeral: true });
    if (member.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Kick failed', 'You cannot kick yourself.')], ephemeral: true });
    await member.kick(reason);
    return interaction.reply({ embeds: [successEmbed('Member kicked', `**${user.tag}** was kicked.\nReason: ${reason}`)] });
  },
};
