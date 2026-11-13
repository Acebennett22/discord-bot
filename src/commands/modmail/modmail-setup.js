const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modmail-setup')
    .setDescription('Admin only: set up modmail.')
    .addChannelOption((o) => o.setName('category').setDescription('Category for modmail thread channels').addChannelTypes(ChannelType.GuildCategory).setRequired(false))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable modmail?').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const category = interaction.options.getChannel('category');
    const enabled = interaction.options.getBoolean('enabled');
    const patch = {};
    if (category) patch.modmailCategoryId = category.id;
    if (enabled !== null) patch.modmailEnabled = enabled;
    if (!Object.keys(patch).length) {
      const s = await getGuildSettings(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('Modmail settings', `Enabled: **${s.modmailEnabled ? 'yes' : 'no'}**\nCategory: ${s.modmailCategoryId ? `<#${s.modmailCategoryId}>` : 'not set'}\n\nWhen enabled, users DM the bot and staff answer from a thread channel here.`)], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, patch);
    const s = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Modmail updated', `Enabled: **${s.modmailEnabled ? 'yes' : 'no'}**\nCategory: ${s.modmailCategoryId ? `<#${s.modmailCategoryId}>` : 'not set'}`)], ephemeral: true });
  },
};
