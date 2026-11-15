const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const sugg = require('../../utils/suggestions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest-status')
    .setDescription('See the status of your own suggestions.'),
  async execute(interaction) {
    if (!db.isEnabled()) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Suggestion history needs MySQL — it is not connected right now.')] });
    }
    const rows = await db.query(
      'SELECT * FROM suggestions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10',
      [interaction.guildId, interaction.user.id]) || [];
    if (!rows.length) {
      return interaction.reply({ embeds: [infoEmbed('Your suggestions', 'You have not submitted any suggestions in this server yet — use /suggest to post one.')] });
    }
    const lines = rows.map((s) => `#${s.id} — **${s.title}**\n${sugg.STATUS_LABEL[s.status]} · 👍 ${s.votes_up} · 👎 ${s.votes_down} · <t:${Math.floor(new Date(s.created_at).getTime() / 1000)}:R>`);
    return interaction.reply({ embeds: [infoEmbed('Your suggestions', lines.join('\n\n'))] });
  },
};
