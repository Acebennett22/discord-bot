const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { providers } = require('../../utils/gameServers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gameserver-add')
    .setDescription('Admin only: track a game server (provider, host, port).')
    .addStringOption((o) => o.setName('name').setDescription('Display name, e.g. Rust Main').setRequired(true))
    .addStringOption((o) => o.setName('provider').setDescription('Query provider').setRequired(true)
      .addChoices(...Object.values(providers).map((p) => ({ name: p.name, value: p.id }))))
    .addStringOption((o) => o.setName('host').setDescription('Server host/IP').setRequired(true))
    .addIntegerOption((o) => o.setName('port').setDescription('Query port (e.g. 25565 Minecraft, 28015 Rust)'))
    .addChannelOption((o) => o.setName('notify_channel').setDescription('Channel for online/offline alerts (optional)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Tracked game servers are stored in MySQL.')] });
    const provider = interaction.options.getString('provider');
    if (provider === 'manual') {
      return interaction.reply({ embeds: [infoEmbed('Manual provider', 'The "manual" provider has no query protocol (e.g. The Isle) — add it in config.json `gameServers.custom` as an informational entry instead; DB tracking is for queryable servers.')] });
    }
    const name = interaction.options.getString('name');
    const host = interaction.options.getString('host');
    const port = interaction.options.getInteger('port');
    const notify = interaction.options.getChannel('notify_channel');
    await db.query(
      'INSERT INTO game_servers (guild_id, name, provider, host, port, notify_channel_id) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.guildId, name, provider, host, port || null, notify?.id || null],
    );
    return interaction.reply({  embeds: [successEmbed('Game server added', `Tracking **${name}** via **${providers[provider].name}** at \`${host}${port ? `:${port}` : ''}\`.${notify ? `\nOnline/offline alerts go to <#${notify.id}>.` : ''}\nCheck it with /serverstatus ${name}.`)] });
  },
};
