const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');
const { allServers, providers } = require('../../utils/gameServers');

module.exports = {
  data: new SlashCommandBuilder().setName('gameserver-list').setDescription('List all tracked game servers and their providers.'),
  async execute(interaction) {
    const servers = await allServers(interaction.guildId);
    if (!servers.length) return interaction.reply({ embeds: [infoEmbed('Game servers', 'No game servers are tracked yet. Add one with /gameserver-add or in config.json `gameServers.custom`.')] });
    return interaction.reply({ embeds: [infoEmbed('🎮 Tracked game servers', servers.map((s) => `**${s.name}** — ${providers[s.provider]?.name || s.provider} · \`${s.host}${s.port ? `:${s.port}` : ''}\` · ${s.source === 'config' ? 'config' : 'this server'}`).join('\n'))] });
  },
};
