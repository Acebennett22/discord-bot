const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newmemberlinks-setup')
    .setDescription('Admin only: block new members from posting links for their first days.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the new-member link block on or off'))
    .addIntegerOption((o) => o.setName('days').setDescription('Members younger than this many days cannot post links (default 7)').setMinValue(1).setMaxValue(90))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    const days = interaction.options.getInteger('days');
    const current = await getGuildSettings(interaction.guildId);
    const patch = {};
    if (enabled !== null) patch.newMemberLinkEnabled = enabled;
    if (days !== null) patch.newMemberLinkDays = days;
    const { settings } = await setGuildSettings(interaction.guildId, patch);
    return interaction.reply({ embeds: [successEmbed('New-member link block saved', [
      `**Enabled:** ${settings.newMemberLinkEnabled ? '✅ on' : '❌ off'}`,
      `**Blocked for:** members who joined less than **${settings.newMemberLinkDays} day(s)** ago`,
      'Blocked messages are deleted, the member gets a warning that deletes itself after 10 seconds, and the block is logged to Automod actions. Staff roles and Automod-exempt roles/channels bypass it.',
    ].join('\n'))] });
  },
};
