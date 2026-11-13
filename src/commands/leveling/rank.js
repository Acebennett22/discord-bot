const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getRank, xpIntoLevel, progressBar } = require('../../utils/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your level, XP, and rank in this server.')
    .addUserOption((o) => o.setName('user').setDescription('User to check (defaults to you)')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const rank = await getRank(user.id, interaction.guildId);
    if (!rank) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL — connect the database first.')], ephemeral: true });
    const { level, into, needed } = xpIntoLevel(rank.xp);
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed(`🏆 Rank — ${user.tag}`, [
      `**Level:** ${level} · **Rank:** #${rank.rank}`,
      `**XP:** ${rank.xp} (${into}/${needed} to level ${level + 1})`,
      `${progressBar(into, needed)}`,
    ].join('\n'))] });
  },
};
