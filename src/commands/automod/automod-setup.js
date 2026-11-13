const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const automod = require('../../utils/automod');

const ACTIONS = ['delete', 'warn', 'timeout', 'delete_warn', 'delete_timeout'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod-setup')
    .setDescription('Admin only: configure Automod (spam limits, action, link/invite blocking, log channel).')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn Automod on or off'))
    .addIntegerOption((o) => o.setName('spam_max').setDescription('Max messages before spam triggers (default 5)').setMinValue(2).setMaxValue(50))
    .addIntegerOption((o) => o.setName('spam_window').setDescription('Spam window in seconds (default 5)').setMinValue(2).setMaxValue(120))
    .addStringOption((o) => o.setName('spam_action').setDescription('What happens on a spam/automod hit').addChoices(
      { name: 'Delete only', value: 'delete' },
      { name: 'Warn only', value: 'warn' },
      { name: 'Timeout only', value: 'timeout' },
      { name: 'Delete + warn', value: 'delete_warn' },
      { name: 'Delete + timeout', value: 'delete_timeout' },
    ))
    .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout length in minutes when the action includes a timeout (default 10)').setMinValue(1).setMaxValue(40320))
    .addBooleanOption((o) => o.setName('block_links').setDescription('Delete messages containing links'))
    .addBooleanOption((o) => o.setName('block_invites').setDescription('Delete messages containing Discord invite links'))
    .addChannelOption((o) => o.setName('log_channel').setDescription('Channel for Automod action logs').addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const patch = {};
    const getBool = (name) => interaction.options.getBoolean(name);
    if (getBool('enabled') !== null) patch.enabled = getBool('enabled');
    if (interaction.options.getInteger('spam_max') !== null) patch.spamMaxMessages = interaction.options.getInteger('spam_max');
    if (interaction.options.getInteger('spam_window') !== null) patch.spamWindowSeconds = interaction.options.getInteger('spam_window');
    const action = interaction.options.getString('spam_action');
    if (action) patch.spamAction = ACTIONS.includes(action) ? action : 'delete_warn';
    if (interaction.options.getInteger('timeout_minutes') !== null) patch.spamTimeoutMinutes = interaction.options.getInteger('timeout_minutes');
    if (getBool('block_links') !== null) patch.blockLinks = getBool('block_links');
    if (getBool('block_invites') !== null) patch.blockInvites = getBool('block_invites');
    const logChannel = interaction.options.getChannel('log_channel');
    if (logChannel) patch.logChannelId = logChannel.id;
    if (!Object.keys(patch).length) {
      return interaction.reply({ embeds: [errorEmbed('Nothing to set', 'Give at least one option — or run /automod to see the current settings.')], ephemeral: true });
    }
    const { saved, settings } = await automod.setSettings(interaction.guildId, patch);
    const lines = [
      `Status: ${settings.enabled ? '✅ enabled' : '❌ disabled'}`,
      `Spam: ${settings.spamMaxMessages}+ messages in ${settings.spamWindowSeconds}s → ${settings.spamAction}`,
      `Block links: ${settings.blockLinks ? 'on' : 'off'} · Block invites: ${settings.blockInvites ? 'on' : 'off'}`,
      `Log channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set'}`,
    ];
    if (!saved) lines.push('\n⚠️ MySQL is not connected — these settings are only kept in memory for this run.');
    return interaction.reply({ embeds: [successEmbed('Automod settings saved', lines.join('\n'))], ephemeral: true });
  },
};
