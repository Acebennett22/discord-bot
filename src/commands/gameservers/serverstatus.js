const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { allServers, queryServer, providers } = require('../../utils/gameServers');
const db = require('../../utils/database');

function statusLine(s, st) {
  const icon = st.online === true ? '🟢' : st.online === false ? '🔴' : '⚪';
  const players = st.players != null ? `${st.players}${st.maxPlayers != null ? `/${st.maxPlayers}` : ''} players` : 'players unknown';
  const extra = [st.map ? `Map: ${st.map}` : null, st.version ? `Version: ${st.version}` : null, st.motd ? `“${String(st.motd).slice(0, 80)}”` : null].filter(Boolean).join(' · ');
  return `${icon} **${s.name}** (${providers[s.provider]?.name || s.provider}) — ${st.online === null ? 'status unknown' : st.online ? 'Online' : 'Offline'} · ${players}${extra ? `\n  ${extra}` : ''}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverstatus')
    .setDescription('Live status for a game server, or all tracked servers.')
    .addStringOption((o) => o.setName('game').setDescription('Game/server name (leave blank for all)')),
  async execute(interaction) {
    const servers = await allServers(interaction.guildId);
    const wanted = interaction.options.getString('game');
    const filtered = wanted ? servers.filter((s) => s.name.toLowerCase().includes(wanted.toLowerCase())) : servers;
    if (!filtered.length) {
      return interaction.reply({ embeds: [errorEmbed('No game servers', wanted ? `No tracked server matches "${wanted}".` : 'No game servers are configured yet. Add one with /gameserver-add or in config.json `gameServers.custom`.')], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const lines = [];
    for (const s of filtered) {
      const st = await queryServer(s);
      lines.push(statusLine(s, st));
      if (typeof s.id === 'number') {
        const { recordStatus } = require('../../utils/gameServers');
        await recordStatus(s.id, st);
      }
    }
    let lastChecked = '';
    if (db.isEnabled() && typeof filtered[0].id === 'number') {
      const rows = await db.query('SELECT MAX(checked_at) AS last FROM game_server_status WHERE server_id IN (?)', [filtered.filter((s) => typeof s.id === 'number').map((s) => s.id)]);
      if (rows?.[0]?.last) lastChecked = `\n\nLast checked: ${new Date(rows[0].last).toLocaleString()}`;
    }
    return interaction.editReply({ embeds: [infoEmbed('🎮 Game server status', lines.join('\n\n') + lastChecked)] });
  },
};
