const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

function quoteLine(q) {
  return `**#${q.id}** — "${String(q.content).slice(0, 120)}" — <@${q.author_id}> · <t:${Math.floor(new Date(q.created_at).getTime() / 1000)}:R>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quotes')
    .setDescription('List recent quotes (or one user\'s quotes).')
    .addUserOption((o) => o.setName('user').setDescription('Show only this user\'s quotes').setRequired(false)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Quotes need MySQL.')] });
    const user = interaction.options.getUser('user');
    const rows = user
      ? await db.query('SELECT * FROM quotes WHERE guild_id = ? AND author_id = ? ORDER BY created_at DESC LIMIT 10', [interaction.guildId, user.id])
      : await db.query('SELECT * FROM quotes WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [infoEmbed('Quotes', user ? `${user.username} has no saved quotes yet.` : 'No quotes saved in this server yet. Use /quote to save one.')] });
    return interaction.reply({ embeds: [infoEmbed(user ? `Quotes by ${user.username}` : 'Recent quotes', rows.map(quoteLine).join('\n'))] });
  },
};
