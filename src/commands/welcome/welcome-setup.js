const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');const { getGuildSettings, setGuildSettings, DEFAULT_WELCOME_MESSAGE } = require('../../utils/guildSettings');
const { formatMessage } = require('../../utils/welcome');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-setup')
    .setDescription('Admin only: set the welcome channel and message template.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for welcome messages').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Welcome template — placeholders: {user} {username} {server} {membercount}').setMaxLength(2000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to set up welcome messages.')], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const patch = { welcomeChannelId: channel.id, welcomeEnabled: true };
    if (message) patch.welcomeMessage = message;
    const { saved, settings } = await setGuildSettings(interaction.guildId, patch);
    const preview = formatMessage(settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE, {
      id: interaction.user.id, user: interaction.user, guild: interaction.guild,
    });
    const embed = infoEmbed('👋 Welcome messages', `New members will be welcomed in ${channel} with this message:`);
    embed.addFields({ name: 'Template', value: (settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE).slice(0, 1024), inline: false },
      { name: 'Preview (for you)', value: preview.slice(0, 1024), inline: false },
      { name: 'Status', value: '✅ Enabled — use /welcome-toggle to turn it off.', inline: false });
    if (!saved) embed.addFields({ name: '⚠️ Not saved to database', value: 'MySQL is not connected — this is only kept in memory for this run.', inline: false });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
