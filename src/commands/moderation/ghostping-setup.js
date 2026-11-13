const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ghostping-setup')
    .setDescription('Admin only: set up anti-ghost-ping callouts.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable ghost-ping callouts?').setRequired(false))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for callouts (default: same channel)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const patch = {};
    if (enabled !== null) patch.ghostpingEnabled = enabled;
    if (channel) patch.ghostpingChannelId = channel.id;
    if (!Object.keys(patch).length) {
      const s = await getGuildSettings(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('Ghost-ping settings', `Enabled: **${s.ghostpingEnabled ? 'yes' : 'no'}**\nCallout channel: ${s.ghostpingChannelId ? `<#${s.ghostpingChannelId}>` : 'same channel as the deleted message'}\n\nBot-deleted messages (automod, purge) are ignored; max 1 callout per user per minute.`)], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, patch);
    const s = await getGuildSettings(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('Ghost-ping updated', `Enabled: **${s.ghostpingEnabled ? 'yes' : 'no'}**\nCallout channel: ${s.ghostpingChannelId ? `<#${s.ghostpingChannelId}>` : 'same channel as the deleted message'}`)], ephemeral: true });
  },
};
