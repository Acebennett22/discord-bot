const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote-random')
    .setDescription('Post a random saved quote from this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Quotes need MySQL.')], ephemeral: true });
    const rows = await db.query('SELECT * FROM quotes WHERE guild_id = ? ORDER BY RAND() LIMIT 1', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [errorEmbed('No quotes yet', 'No quotes saved in this server yet. Use /quote to save one.')], ephemeral: true });
    const q = rows[0];
    const author = await interaction.client.users.fetch(q.author_id).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setAuthor({ name: author?.tag || 'Unknown user', iconURL: author?.displayAvatarURL?.() || null })
      .setDescription(`"${q.content}"`)
      .setFooter({ text: `Quote #${q.id} · ${new Date(q.created_at).toLocaleDateString()}` });
    return interaction.reply({ embeds: [embed] });
  },
};
