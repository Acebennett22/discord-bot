const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');
const { isAiConfigured } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-setup')
    .setDescription('Admin only: set up the AI chat channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel where members can chat with the AI').setRequired(false))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable AI chat?').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const enabled = interaction.options.getBoolean('enabled');
    const patch = {};
    if (channel) patch.aiChannelId = channel.id;
    if (enabled !== null) patch.aiEnabled = enabled;
    if (!Object.keys(patch).length) {
      const s = await getGuildSettings(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('AI chat settings', `Enabled: **${s.aiEnabled ? 'yes' : 'no'}**\nChannel: ${s.aiChannelId ? `<#${s.aiChannelId}>` : 'not set'}\nAPI key configured: **${isAiConfigured() ? 'yes' : 'no — add ai.apiKey in config.json'}**`)], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, patch);
    const s = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('AI chat updated', `Enabled: **${s.aiEnabled ? 'yes' : 'no'}**\nChannel: ${s.aiChannelId ? `<#${s.aiChannelId}>` : 'not set'}${isAiConfigured() ? '' : '\n⚠️ No AI API key is configured yet — add ai.apiKey in config.json (get one at platform.openai.com/api-keys).'}`)], ephemeral: true });
  },
};
