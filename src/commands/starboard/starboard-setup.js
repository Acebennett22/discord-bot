const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { setPremiumSettings, getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard-setup')
    .setDescription('Admin only: set the starboard channel and star threshold.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel starred messages get posted to').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addIntegerOption((o) => o.setName('threshold').setDescription('Stars needed (default 3)').setMinValue(1).setMaxValue(25))
    .addStringOption((o) => o.setName('emoji').setDescription('Star emoji to count (default ⭐)').setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Starboard only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to set up the starboard.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so settings can\'t be saved right now.')] });
    const channel = interaction.options.getChannel('channel');
    const current = await getPremiumSettings(interaction.guildId);
    const threshold = interaction.options.getInteger('threshold') ?? current.starboardThreshold ?? 3;
    const emoji = interaction.options.getString('emoji') || current.starboardEmoji || '⭐';
    const { saved } = await setPremiumSettings(interaction.guildId, { starboardChannelId: channel.id, starboardThreshold: threshold, starboardEmoji: emoji });
    if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'Settings were kept in memory only — MySQL is not connected.')] });
    return interaction.reply({ embeds: [successEmbed('Starboard set up', `⭐ Messages with **${threshold} ${emoji}** reactions will be posted to ${channel}.`)] });
  },
};
