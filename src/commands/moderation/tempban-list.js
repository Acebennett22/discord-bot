const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getActiveTempbans } = require('../../utils/tempban');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban-list')
    .setDescription('List active tempbans in this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction) {
    const rows = await getActiveTempbans(interaction.guild.id).catch(() => null);
    if (rows === null) {
      return interaction.reply({ embeds: [errorEmbed('Tempban list unavailable', 'The database is unavailable, so active tempbans cannot be listed right now.')] });
    }
    if (!rows.length) {
      return interaction.reply({ embeds: [infoEmbed('Active tempbans', 'There are no active tempbans in this server.')] });
    }
    const fields = rows.slice(0, 25).map((row) => {
      const expiryTs = Math.floor(new Date(row.expires_at).getTime() / 1000);
      return {
        name: `<@${row.user_id}> (${row.user_id})`,
        value: `Banned by: <@${row.banned_by}>\nReason: ${row.reason || 'No reason given'}\nExpires: <t:${expiryTs}:F> (<t:${expiryTs}:R>)`,
      };
    });
    const extra = rows.length > 25 ? `\n…and ${rows.length - 25} more.` : '';
    return interaction.reply({
      
      embeds: [infoEmbed(`Active tempbans (${rows.length})`, `Tempbans currently in effect in this server.${extra}`, fields)],
    });
  },
};
