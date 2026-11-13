const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { updateWidget } = require('../../utils/mcWidgets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mcstatus-setup')
    .setDescription('Admin only: post a live Minecraft status widget in a channel.')
    .addIntegerOption((o) => o.setName('server').setDescription('Game server ID (see /gameserver-list)').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for the status widget').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Status widgets need MySQL.')], ephemeral: true });
    const serverId = interaction.options.getInteger('server');
    const channel = interaction.options.getChannel('channel');
    const rows = await db.query('SELECT * FROM game_servers WHERE id = ? AND guild_id = ?', [serverId, interaction.guildId]);
    const server = rows?.[0];
    if (!server) return interaction.reply({ embeds: [errorEmbed('Server not found', `No game server with ID ${serverId} in this server. Use /gameserver-list to see IDs.`)], ephemeral: true });
    if (server.provider !== 'minecraft') {
      return interaction.reply({ embeds: [errorEmbed('Not a Minecraft server', `**${server.name}** uses the ${server.provider} provider — status widgets are for Minecraft servers.`)], ephemeral: true });
    }
    await db.query(
      'INSERT INTO mc_widgets (guild_id, server_id, channel_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id)',
      [interaction.guildId, serverId, channel.id],
    );
    const existing = await db.query('SELECT * FROM mc_widgets WHERE guild_id = ? AND server_id = ?', [interaction.guildId, serverId]);
    const widget = existing?.[0];
    await updateWidget(interaction.client, widget).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Minecraft widget set up', `🟢 Live status for **${server.name}** will update every 5 minutes in <#${channel.id}>.`)], ephemeral: true });
  },
};
