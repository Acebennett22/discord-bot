const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const { formatMessage } = require('../../utils/welcome');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-dm')
    .setDescription('Admin only: set up or toggle the welcome DM sent to new members.')
    .addSubcommand((s) => s.setName('set')
      .setDescription('Set the welcome DM message (enables welcome DMs).')
      .addStringOption((o) => o.setName('message').setDescription('DM template — placeholders: {user} {username} {server}').setMaxLength(2000).setRequired(true)))
    .addSubcommand((s) => s.setName('toggle')
      .setDescription('Turn welcome DMs on or off.')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn welcome DMs on or off').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to manage welcome DMs.')], ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const message = interaction.options.getString('message');
      const { saved, settings } = await setGuildSettings(interaction.guildId, { welcomeDmMessage: message, welcomeDmEnabled: true });
      const preview = formatMessage(message, {
        id: interaction.user.id, user: interaction.user, guild: interaction.guild,
      });
      const embed = successEmbed('Welcome DM set', 'New members will now receive this DM when they join:');
      embed.addFields(
        { name: 'Template', value: message.slice(0, 1024), inline: false },
        { name: 'Preview (for you)', value: preview.slice(0, 1024), inline: false },
        { name: 'Status', value: '✅ Enabled — use /welcome-dm toggle to turn it off.', inline: false },
      );
      if (!saved) embed.addFields({ name: '⚠️ Not saved to database', value: 'MySQL is not connected — this is only kept in memory for this run.', inline: false });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    // toggle
    const enabled = interaction.options.getBoolean('enabled');
    const { settings } = await setGuildSettings(interaction.guildId, { welcomeDmEnabled: enabled });
    if (enabled && !settings.welcomeDmMessage) {
      return interaction.reply({ embeds: [successEmbed('Welcome DMs enabled', 'No DM message is set yet — run /welcome-dm set to write one first.')], ephemeral: true });
    }
    const preview = settings.welcomeDmMessage
      ? formatMessage(settings.welcomeDmMessage, { id: interaction.user.id, user: interaction.user, guild: interaction.guild })
      : null;
    const embed = infoEmbed(`📬 Welcome DMs ${enabled ? 'enabled' : 'disabled'}`,
      enabled
        ? `New members will be DM'd when they join.${preview ? `\n\n**Preview (for you):**\n${preview.slice(0, 1500)}` : ''}`
        : 'New members will no longer receive a welcome DM.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
