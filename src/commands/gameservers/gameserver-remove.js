const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gameserver-remove')
    .setDescription('Admin only: stop tracking a game server.')
    .addStringOption((o) => o.setName('name').setDescription('Display name of the server to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Tracked game servers are stored in MySQL.')], ephemeral: true });
    const res = await db.query('DELETE FROM game_servers WHERE guild_id = ? AND name = ?', [interaction.guildId, interaction.options.getString('name')]);
    if (!res || res.affectedRows === 0) return interaction.reply({ embeds: [errorEmbed('Not found', 'No DB-tracked server with that name in this server. (Config-level entries in config.json are edited there.)')], ephemeral: true });
    return interaction.reply({ ephemeral: true, embeds: [successEmbed('Game server removed', `Stopped tracking **${interaction.options.getString('name')}**.`)] });
  },
};
