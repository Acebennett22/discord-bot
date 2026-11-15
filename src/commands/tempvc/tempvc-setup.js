const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvc-setup')
    .setDescription('Admin only: set up temporary voice channels for this server.')
    .addChannelOption((o) => o.setName('create_channel').setDescription('Voice channel members join to spawn their own temp channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
    .addChannelOption((o) => o.setName('category').setDescription('Category new temp channels are created under (default: the create channel\'s category)').addChannelTypes(ChannelType.GuildCategory))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable temp voice channels (default: true)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Temp VC setup needs MySQL.')] });
    const createChannel = interaction.options.getChannel('create_channel');
    const category = interaction.options.getChannel('category');
    const enabled = interaction.options.getBoolean('enabled');
    const isEnabled = enabled !== null && enabled !== undefined ? enabled : true;
    // There is no dedicated tempvcEnabled guild-settings key: temp VC
    // creation is driven by tempvcCreateChannelId (see src/utils/tempvc.js),
    // so disabling clears the create channel; enabling (re)sets it.
    const patch = {};
    if (isEnabled) patch.tempvcCreateChannelId = createChannel.id;
    else patch.tempvcCreateChannelId = '';
    if (category) patch.tempvcCategoryId = category.id;
    await setGuildSettings(interaction.guildId, patch);
    const settings = await getGuildSettings(interaction.guildId);
    const active = Boolean(settings.tempvcCreateChannelId);
    return interaction.reply({ embeds: [successEmbed('Temp VC setup', [
      `Status: **${active ? 'enabled' : 'disabled'}**`,
      `Create channel: ${settings.tempvcCreateChannelId ? `<#${settings.tempvcCreateChannelId}>` : 'not set'}`,
      `Category: ${settings.tempvcCategoryId ? `<#${settings.tempvcCategoryId}>` : 'not set (uses the create channel\'s category)'}`,
      active ? 'Members who join the create channel will get their own temp voice channel, deleted when empty.' : 'Temp voice channels are off — no new temp channels will be created.',
    ].join('\n'))] });
  },
};
