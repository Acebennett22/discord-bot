const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings } = require('../../utils/guildSettings');
const reengage = require('../../utils/reengage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reengage-preview')
    .setDescription('Admin: show who would get a re-engagement message — sends nothing.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Re-engagement needs MySQL.')], ephemeral: true });
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to preview re-engagement.')], ephemeral: true });
    }
    const settings = await getGuildSettings(interaction.guildId);
    const days = settings.reengageDays || 30;
    const inactive = await reengage.findInactiveMembers(interaction.guild, days);
    if (!inactive.length) return interaction.reply({ embeds: [infoEmbed('👋 Re-engagement preview', `Nobody would be messaged right now (no members inactive for ${days}+ days).`)], ephemeral: true });
    const lines = inactive.slice(0, 20).map(({ member, lastActivity }) => `• <@${member.id}> — last active ${lastActivity ? `<t:${Math.floor(new Date(lastActivity).getTime() / 1000)}:R>` : 'never recorded'}`);
    return interaction.reply({ embeds: [infoEmbed('👋 Re-engagement preview', `**${inactive.length}** member${inactive.length === 1 ? '' : 's'} would be messaged (inactive ${days}+ days):\n${lines.join('\n')}${inactive.length > 20 ? `\n…and ${inactive.length - 20} more` : ''}\n\nThis preview sends nothing.`)], ephemeral: true });
  },
};
