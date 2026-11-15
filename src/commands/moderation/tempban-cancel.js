const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { getActiveTempban, cancelTempban } = require('../../utils/tempban');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban-cancel')
    .setDescription('Cancel a tempban early and unban the user.')
    .addUserOption((o) => o.setName('user').setDescription('User whose tempban to cancel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const record = await getActiveTempban(interaction.guild.id, user.id).catch(() => null);
    if (!record) {
      return interaction.reply({ embeds: [errorEmbed('Tempban cancel failed', `**${user.tag}** has no active tempban in this server (or the database is unavailable).`)] });
    }
    // Unban only if still banned; if they were already manually unbanned,
    // just clear the record.
    const ban = await interaction.guild.bans.fetch(user.id).catch(() => null);
    if (ban) await interaction.guild.members.unban(user.id, `Tempban cancelled early by ${interaction.user.tag}`);
    const cancelled = await cancelTempban(interaction.guild.id, user.id).catch(() => false);
    if (!cancelled) {
      return interaction.reply({ embeds: [errorEmbed('Tempban cancel failed', 'The database could not update the tempban record. The user may already be unbanned — check /tempban-list.')] });
    }
    return interaction.reply({
      
      embeds: [successEmbed('Tempban cancelled', `**${user.tag}** has been unbanned early. Their tempban (reason: ${record.reason || 'No reason given'}) is cancelled.`)],
    });
  },
};
