const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getMaxLevel, getUserPrestige, levelForXp } = require('../../utils/leveling');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prestige')
    .setDescription('Reset to level 1 at the max level to gain +1 prestige (permanent +10% XP).'),
  async execute(interaction) {
    const maxLevel = getMaxLevel();
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Prestige needs MySQL — connect the database first.')] });
    const rows = await db.query('SELECT xp FROM user_levels WHERE user_id = ? AND guild_id = ?', [interaction.user.id, interaction.guildId]);
    const level = levelForXp(rows?.[0]?.xp || 0);
    const prestige = await getUserPrestige(interaction.user.id, interaction.guildId);
    if (level < maxLevel) {
      return interaction.reply({
        
        embeds: [infoEmbed('⭐ Prestige', [
          `You are **level ${level}** with **${prestige}** prestige${prestige === 1 ? '' : 's'}.`,
          `Reach **level ${maxLevel}** to prestige. Prestiging resets your level and XP to 0 and grants +1 prestige — a permanent +10% XP multiplier (capped at +100% at prestige 10).`,
          prestige > 0 ? `Your current XP multiplier is **x${(1 + Math.min(prestige, 10) * 0.1).toFixed(1)}**.` : '',
        ].filter(Boolean).join('\n'))],
      });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prestige_confirm:${interaction.user.id}`).setLabel(`Prestige to ${prestige + 1} (resets level + XP)`).setStyle(ButtonStyle.Danger).setEmoji('⭐'),
      new ButtonBuilder().setCustomId(`prestige_cancel:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
      
      embeds: [infoEmbed('⭐ Prestige?', [
        `You are at **level ${maxLevel}** with **${prestige}** prestige${prestige === 1 ? '' : 's'}.`,
        `Prestiging will **reset your level and XP to 0** and grant **prestige ${prestige + 1}** — a permanent **x${(1 + Math.min(prestige + 1, 10) * 0.1).toFixed(1)}** XP multiplier.`,
        'This cannot be undone. Are you sure?',
      ].join('\n'))],
      components: [row],
    });
  },
};
