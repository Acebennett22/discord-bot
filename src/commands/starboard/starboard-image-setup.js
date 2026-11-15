const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard-image-setup')
    .setDescription('Admin: send starred image/video posts to their own starboard channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('channel').setDescription('Image starboard channel (blank = use the main starboard)').setRequired(false))
    .addIntegerOption((o) => o.setName('threshold').setDescription('Stars needed (default 3)').setMinValue(1).setMaxValue(50)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Starboard needs MySQL.')] });
    const patch = {};
    const channel = interaction.options.getChannel('channel');
    if (channel) patch.imageStarboardChannelId = channel.id;
    const threshold = interaction.options.getInteger('threshold');
    if (threshold !== null) patch.imageStarboardThreshold = threshold;
    if (!Object.keys(patch).length) {
      const settings = await getGuildSettings(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('Image starboard', [
        `Channel: ${settings.imageStarboardChannelId ? `<#${settings.imageStarboardChannelId}>` : 'not set — image posts go to the main starboard'}`,
        `Threshold: **${settings.imageStarboardThreshold}** stars`,
      ].join('\n'))] });
    }
    await setGuildSettings(interaction.guildId, patch);
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Image starboard', [
      `Channel: ${settings.imageStarboardChannelId ? `<#${settings.imageStarboardChannelId}>` : 'not set'}`,
      `Threshold: **${settings.imageStarboardThreshold}** stars`,
      'Only messages with image or video attachments go here; everything else still uses the main starboard.',
    ].join('\n'))] });
  },
};
