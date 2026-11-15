const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { setGuildSettings, DEFAULT_GOODBYE_MESSAGE } = require('../../utils/guildSettings');
const { formatMessage } = require('../../utils/welcome');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('goodbye-setup')
    .setDescription('Admin only: set the goodbye channel and message template.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for goodbye messages').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Goodbye template — placeholders: {user} {username} {server} {membercount}').setMaxLength(2000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to set up goodbye messages.')] });
    }
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const patch = { goodbyeChannelId: channel.id, goodbyeEnabled: true };
    if (message) patch.goodbyeMessage = message;
    const { saved, settings } = await setGuildSettings(interaction.guildId, patch);
    const preview = formatMessage(settings.goodbyeMessage || DEFAULT_GOODBYE_MESSAGE, {
      id: interaction.user.id, user: interaction.user, guild: interaction.guild,
    });
    const embed = infoEmbed('👋 Goodbye messages', `Members who leave will be said goodbye to in ${channel}:`);
    embed.addFields({ name: 'Template', value: (settings.goodbyeMessage || DEFAULT_GOODBYE_MESSAGE).slice(0, 1024), inline: false },
      { name: 'Preview (for you)', value: preview.slice(0, 1024), inline: false },
      { name: 'Status', value: '✅ Enabled — use /goodbye-toggle to turn it off.', inline: false });
    if (!saved) embed.addFields({ name: '⚠️ Not saved to database', value: 'MySQL is not connected — this is only kept in memory for this run.', inline: false });
    return interaction.reply({ embeds: [embed] });
  },
};
