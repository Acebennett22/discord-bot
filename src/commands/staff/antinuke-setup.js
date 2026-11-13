const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const { parseWhitelist } = require('../../utils/antinuke');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antinuke-setup')
    .setDescription('Admin only: configure anti-nuke protection for this server.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn anti-nuke protection on or off'))
    .addStringOption((o) => o.setName('action').setDescription('What to do when the threshold is hit')
      .addChoices(
        { name: 'kick', value: 'kick' },
        { name: 'ban', value: 'ban' },
        { name: 'lockdown (remove all their roles)', value: 'lockdown' },
      ))
    .addIntegerOption((o) => o.setName('threshold').setDescription('Destructive actions in 60s before acting (1-20)').setMinValue(1).setMaxValue(20))
    .addRoleOption((o) => o.setName('whitelist_role').setDescription('A role to exempt from anti-nuke (appends to the whitelist)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Anti-nuke is configured per server.')], ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'Only server administrators can configure anti-nuke.')], ephemeral: true });
    }
    const enabled = interaction.options.getBoolean('enabled');
    const action = interaction.options.getString('action');
    const threshold = interaction.options.getInteger('threshold');
    const whitelistRole = interaction.options.getRole('whitelist_role');

    const current = await getGuildSettings(interaction.guildId);
    if (enabled === null && action === null && threshold === null && !whitelistRole) {
      const whitelist = parseWhitelist(current.antInukeWhitelistRoles);
      return interaction.reply({ embeds: [infoEmbed('🛡️ Anti-nuke settings', `**Enabled:** ${current.antInukeEnabled ?? false ? 'Yes' : 'No'}\n**Action:** ${current.antInukeAction || 'kick'}\n**Threshold:** ${current.antInukeThreshold ?? 5} destructive actions in 60s\n**Whitelisted roles:** ${whitelist.length ? whitelist.map((id) => `<@&${id}>`).join(', ') : 'None'}\n**Log channel:** ${current.antInukeLogChannelId ? `<#${current.antInukeLogChannelId}>` : 'Not set (falls back to the general log channel)'}\n\nRe-run with options to change any of these.`)], ephemeral: true });
    }

    const patch = {};
    if (enabled !== null) patch.antInukeEnabled = enabled;
    if (action !== null) patch.antInukeAction = action;
    if (threshold !== null) patch.antInukeThreshold = threshold;
    if (whitelistRole) {
      const whitelist = parseWhitelist(current.antInukeWhitelistRoles);
      if (!whitelist.includes(whitelistRole.id)) whitelist.push(whitelistRole.id);
      patch.antInukeWhitelistRoles = whitelist;
    }
    // NOTE: setGuildSettings only persists keys it knows about — the new
    // antinuke_* columns/DEFAULTS must be added to src/utils/guildSettings.js
    // (see integration report) or these changes live in the 60s cache only.
    const { saved, settings } = await setGuildSettings(interaction.guildId, patch);
    const whitelist = parseWhitelist(settings.antInukeWhitelistRoles);
    const lines = [];
    if (enabled !== null) lines.push(`Enabled: **${enabled ? 'Yes' : 'No'}**`);
    if (action !== null) lines.push(`Action: **${action}**`);
    if (threshold !== null) lines.push(`Threshold: **${threshold}** destructive actions in 60s`);
    if (whitelistRole) lines.push(`Whitelisted role added: <@&${whitelistRole.id}> (total: ${whitelist.length})`);
    return interaction.reply({ embeds: [successEmbed('Anti-nuke updated', `${lines.join('\n')}\n\nCurrent: enabled **${settings.antInukeEnabled ?? false ? 'Yes' : 'No'}** · action **${settings.antInukeAction || 'kick'}** · threshold **${settings.antInukeThreshold ?? 5}**${saved ? '' : '\n⚠️ Database unavailable — these settings are cached in memory only and will be lost on restart.'}`)], ephemeral: true });
  },
};
