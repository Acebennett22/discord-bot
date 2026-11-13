const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('shards').setDescription('Show shard info (count, this shard, guilds per shard, latency).'),
  async execute(interaction) {
    const client = interaction.client;
    if (!client.shard) {
      return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Shards', [
        '**Mode:** Unsharded (single process)',
        `**Guilds:** ${client.guilds.cache.size}`,
        `**Ping:** ${client.ws.ping}ms`,
        '',
        'Run `npm start` (ShardingManager) to run sharded.',
      ].join('\n'))] });
    }
    const shard = client.shard;
    let guildCounts = [];
    let pings = [];
    try {
      guildCounts = await shard.fetchClientValues('guilds.cache.size');
      pings = await shard.fetchClientValues('ws.ping');
    } catch {}
    const lines = [
      `**Total shards:** ${shard.count}`,
      `**This shard:** ${shard.ids.join(', ')}`,
      `**Ping (this shard):** ${client.ws.ping}ms`,
      '',
      '**Guilds per shard:**',
    ];
    guildCounts.forEach((n, i) => lines.push(`Shard ${i}: ${n} guild(s)${pings[i] != null ? ` — ${pings[i]}ms` : ''}`));
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Shards', lines.join('\n'))] });
  },
};
