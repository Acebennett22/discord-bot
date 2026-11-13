const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday-role')
    .setDescription('Admin only: set the role granted to members on their birthday.')
    .addSubcommand((s) => s.setName('set').setDescription('Set the birthday role.')
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant on birthdays').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove the birthday role (announcements still work).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'remove') {
      await setGuildSettings(interaction.guildId, { birthdayRoleId: '' });
      return interaction.reply({ embeds: [successEmbed('Birthday role removed', '🎂 Birthday announcements will continue as before; no role will be granted.')], ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Role too high', `**${role.name}** is above the bot's highest role — move the bot's role higher, or pick a lower role.`)], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, { birthdayRoleId: role.id });
    return interaction.reply({ embeds: [successEmbed('Birthday role set', `🎂 Members will get the **${role.name}** role on their birthday (removed the next day).`)], ephemeral: true });
  },
};
