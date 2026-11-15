const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afkvoice-setup')
    .setDescription('Admin: set up automatic AFK voice kicks for idle members.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn AFK voice kicks on or off').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Idle minutes before moving someone (default 30)').setMinValue(1).setMaxValue(240))
    .addChannelOption((o) => o.setName('afk_channel').setDescription('Voice channel to move idle members to (blank = disconnect them)'))
    .addRoleOption((o) => o.setName('exempt_role').setDescription('Role that is never moved (e.g. staff)')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'AFK voice needs MySQL.')] });
    const patch = { afkVoiceEnabled: interaction.options.getBoolean('enabled') };
    const minutes = interaction.options.getInteger('minutes');
    if (minutes !== null) patch.afkVoiceMinutes = minutes;
    const channel = interaction.options.getChannel('afk_channel');
    if (channel) {
      if (!channel.isVoiceBased()) return interaction.reply({ embeds: [errorEmbed('Not a voice channel', 'The AFK channel must be a voice channel.')] });
      patch.afkVoiceChannelId = channel.id;
    }
    const role = interaction.options.getRole('exempt_role');
    if (role) patch.afkVoiceExemptRoleId = role.id;
    await setGuildSettings(interaction.guildId, patch);
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('AFK voice kicks', [
      `Status: **${settings.afkVoiceEnabled ? 'enabled' : 'disabled'}**`,
      `Idle threshold: **${settings.afkVoiceMinutes} minutes** (muted/deafened continuously)`,
      `Move to: ${settings.afkVoiceChannelId ? `<#${settings.afkVoiceChannelId}>` : '**disconnect**'}`,
      `Exempt role: ${settings.afkVoiceExemptRoleId ? `<@&${settings.afkVoiceExemptRoleId}>` : 'none'}`,
      'Bots and members already in the AFK channel are never moved.',
    ].join('\n'))] });
  },
};
