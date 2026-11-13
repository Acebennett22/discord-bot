const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getRank, xpIntoLevel, progressBar } = require('../../utils/leveling');
const rankCard = require('../../utils/rankCard');

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
    const prestigeLine = rank.prestige > 0 ? `\n**Prestige:** ⭐ ${rank.prestige} (x${(1 + Math.min(rank.prestige, 10) * 0.1).toFixed(1)} XP)` : '';
    const embed = infoEmbed(`🏆 Rank — ${user.tag}`, [
      `**Level:** ${level} · **Rank:** #${rank.rank}${prestigeLine}`,
      `**XP:** ${rank.xp} (${into}/${needed} to level ${level + 1})`,
      `${progressBar(into, needed)}`,
      `**Total messages:** ${(rank.messages || 0).toLocaleString()}`,
    ].join('\n'));
    // Rank card image (1.8.9) — the image is the primary display; the
    // text embed above is the fallback if canvas fails. Total messages
    // counts every message since 1.8.9 (user_levels.messages).
    const card = await rankCard.generateRankCard({
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
      username: user.username,
      level,
      xp: into,
      xpToNext: needed,
      rank: rank.rank,
      totalMessages: rank.messages || 0,
    });
    if (card) {
      return interaction.reply({ ephemeral: true, files: [new AttachmentBuilder(card, { name: 'rank-card.png' })] });
    }
    return interaction.reply({ ephemeral: true, embeds: [embed] });
  },
};
