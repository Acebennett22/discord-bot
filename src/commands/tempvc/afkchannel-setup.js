const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afkchannel-setup')
    .setDescription('Admin: auto-create a second AFK voice channel when the first fills up.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn AFK auto-create on or off').setRequired(true))
    .addChannelOption((o) => o.setName('afk_channel').setDescription('Primary AFK voice channel'))
    .addIntegerOption((o) => o.setName('max_users').setDescription('Users in the primary channel before a second opens (default 10)').setMinValue(2).setMaxValue(99)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'AFK auto-create needs MySQL.')] });
    const patch = { afkAutocreateEnabled: interaction.options.getBoolean('enabled') };
    const channel = interaction.options.getChannel('afk_channel');
    if (channel) {
      if (!channel.isVoiceBased()) return interaction.reply({ embeds: [errorEmbed('Not a voice channel', 'The AFK channel must be a voice channel.')] });
      patch.afkChannelId = channel.id;
    }
    const max = interaction.options.getInteger('max_users');
    if (max !== null) patch.afkMaxUsers = max;
    await setGuildSettings(interaction.guildId, patch);
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('AFK channel auto-create', [
      `Status: **${settings.afkAutocreateEnabled ? 'enabled' : 'disabled'}**`,
      `Primary AFK channel: ${settings.afkChannelId ? `<#${settings.afkChannelId}>` : 'not set'}`,
      `Second channel ("AFK 2") opens at **${settings.afkMaxUsers}** users and is deleted when it empties.`,
      'If the primary is empty for 10 minutes and the second is also empty, the second is deleted.',
    ].join('\n'))] });
  },
};
