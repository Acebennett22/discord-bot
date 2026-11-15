const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { xpForLevel, levelForXp } = require('../../utils/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlevel')
    .setDescription('Admin only: set a user\'s level or XP.')
    .addUserOption((o) => o.setName('user').setDescription('User to set').setRequired(true))
    .addIntegerOption((o) => o.setName('level').setDescription('Level to set'))
    .addIntegerOption((o) => o.setName('xp').setDescription('Total XP to set'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL.')] });
    const user = interaction.options.getUser('user');
    const level = interaction.options.getInteger('level');
    const xpOpt = interaction.options.getInteger('xp');
    let xp;
    if (xpOpt != null) xp = xpOpt;
    else if (level != null) xp = xpForLevel(level);
    else return interaction.reply({ embeds: [errorEmbed('Nothing to set', 'Give a level or an XP amount.')] });
    const finalLevel = levelForXp(xp);
    await db.query(
      'INSERT INTO user_levels (user_id, guild_id, xp, level) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE xp = VALUES(xp), level = VALUES(level)',
      [user.id, interaction.guildId, xp, finalLevel],
    );
    return interaction.reply({  embeds: [successEmbed('Level set', `**${user.tag}** is now level **${finalLevel}** with **${xp}** XP.`)] });
  },
};
