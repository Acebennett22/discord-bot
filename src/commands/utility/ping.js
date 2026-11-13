const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot\'s latency — shard-aware, lists every shard.'),
  async execute(interaction) {
    const sent = await interaction.reply({ embeds: [infoEmbed('Ping', 'Measuring…')], fetchReply: true });
    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    const client = interaction.client;
    const shard = client.shard;

    if (!shard) {
      return interaction.editReply({ embeds: [infoEmbed('Pong! 🏓', [
        '**Mode:** Unsharded (single process)',
        `**Round-trip:** ${roundTrip}ms`,
        `**API heartbeat:** ${client.ws.ping}ms`,
        `**Guilds on this shard:** ${client.guilds.cache.size}`,
      ].join('\n'))] });
    }

    // Sharded: fetch ping + guild counts from EVERY shard.
    let pings = [];
    let guildCounts = [];
    try { pings = await shard.fetchClientValues('ws.ping'); } catch {}
    try { guildCounts = await shard.fetchClientValues('guilds.cache.size'); } catch {}
    const totalGuilds = guildCounts.reduce((a, b) => a + (b || 0), 0);
    const myShardId = shard.ids[0];
    const lines = pings.map((ping, i) => {
      const marker = i === myShardId ? '▶ ' : '   ';
      const guilds = guildCounts[i] != null ? ` — ${guildCounts[i]} guilds` : '';
      const bold = i === myShardId ? `**Shard ${i} — ${ping}ms${guilds}**` : `Shard ${i} — ${ping}ms${guilds}`;
      return `${marker}${bold}`;
    });
    const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
    const fields = [{ name: `Shards (${shard.count}) — ▶ = this shard`, value: lines.join('\n') || 'Could not fetch shard pings.' }];
    if (avg != null) fields.push({ name: 'Average ping', value: `${avg}ms`, inline: true });
    return interaction.editReply({ embeds: [infoEmbed('Pong! 🏓', [
      `**This shard:** ${myShardId} of ${shard.count}`,
      `**Round-trip (this shard):** ${roundTrip}ms`,
      `**API heartbeat (this shard):** ${client.ws.ping}ms`,
      `**Guilds:** ${client.guilds.cache.size} on this shard · ${totalGuilds} total`,
    ].join('\n'), fields)] });
  },
};
