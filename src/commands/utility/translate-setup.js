const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const translate = require('../../utils/translate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate-setup')
    .setDescription('Admin only: set up auto-translation for channels.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to auto-translate messages in').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName('target').setDescription('Language to translate into (code, e.g. en, es, fr)').setMaxLength(5))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable auto-translation'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Auto-translate needs MySQL.')] });
    const channel = interaction.options.getChannel('channel');
    const target = (interaction.options.getString('target') || 'en').toLowerCase();
    if (!translate.SUPPORTED[target]) {
      return interaction.reply({ embeds: [errorEmbed('Unsupported language', `Supported codes: ${Object.keys(translate.SUPPORTED).join(', ')}.`)] });
    }
    const enabled = interaction.options.getBoolean('enabled');
    const cur = await translate.getTranslateSettings(interaction.guildId);
    const channels = new Set(cur.channels);
    channels.add(channel.id);
    await translate.saveTranslateSettings(interaction.guildId, {
      enabled: enabled !== null && enabled !== undefined ? enabled : true,
      channels: [...channels],
      targetLang: target,
    });
    return interaction.reply({ embeds: [successEmbed('Auto-translate set up', `🌐 Messages in <#${channel.id}> will be auto-translated into **${translate.SUPPORTED[target]}**. Use /translate-setup again to add more channels.`)] });
  },
};
