const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const automod = require('../../utils/automod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Admin only: view the current Automod settings for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    const s = await automod.getSettings(interaction.guildId);
    const embed = infoEmbed('🛡️ Automod settings', s.enabled ? 'Automod is ✅ enabled in this server.' : 'Automod is ❌ disabled in this server — use /automod-setup to turn it on.');
    embed.addFields(
      { name: 'Spam', value: `${s.spamMaxMessages}+ messages in ${s.spamWindowSeconds}s → ${s.spamAction}${s.spamAction.includes('timeout') ? ` (${s.spamTimeoutMinutes} min)` : ''}`, inline: false },
      { name: 'Banned words', value: s.bannedWords.length ? s.bannedWords.join(', ').slice(0, 1024) : 'none — manage with /automod-words', inline: false },
      { name: 'Link blocking', value: s.blockLinks ? '✅ on' : '❌ off', inline: true },
      { name: 'Discord invite blocking', value: s.blockInvites ? '✅ on' : '❌ off', inline: true },
      { name: 'Exempt roles', value: s.exemptRoles.length ? s.exemptRoles.map((r) => `<@&${r}>`).join(' ') : 'none', inline: false },
      { name: 'Exempt channels', value: s.exemptChannels.length ? s.exemptChannels.map((c) => `<#${c}>`).join(' ') : 'none', inline: false },
      { name: 'Log channel', value: s.logChannelId ? `<#${s.logChannelId}>` : 'not set', inline: false },
    );
    return interaction.reply({ embeds: [embed] });
  },
};
