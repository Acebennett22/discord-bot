const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban'))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) return interaction.reply({ embeds: [errorEmbed('Ban failed', 'I cannot ban that member — check my role position and permissions.')] });
    if (user.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Ban failed', 'You cannot ban yourself.')] });
    await interaction.guild.members.ban(user.id, { reason, deleteMessageDays: deleteDays });
    return interaction.reply({  embeds: [successEmbed('Member banned', `**${user.tag}** was banned.\nReason: ${reason}`)] });
  },
};
