const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather-home')
    .setDescription('Set, view, or clear your personal home location for /weather.')
    .addSubcommand((s) => s.setName('set').setDescription('Set your home location.')
      .addStringOption((o) => o.setName('location').setDescription('City name, ZIP code, or "latitude,longitude"').setRequired(true).setMaxLength(128)))
    .addSubcommand((s) => s.setName('clear').setDescription('Clear your home location.'))
    .addSubcommand((s) => s.setName('view').setDescription('Show your saved home location.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Home locations need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const location = interaction.options.getString('location');
      await db.query(
        `INSERT INTO user_weather (guild_id, user_id, location) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE location = VALUES(location)`,
        [interaction.guildId, interaction.user.id, location],
      );
      return interaction.reply({ embeds: [successEmbed('Home location saved', `Your home location is now **${location}**. /weather with no location will use it first.`)] });
    }
    if (sub === 'clear') {
      await db.query('DELETE FROM user_weather WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
      return interaction.reply({ embeds: [successEmbed('Home location cleared', '/weather with no location will now use the server default (if one is set).')] });
    }
    // view
    const rows = await db.query('SELECT location FROM user_weather WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
    const location = rows?.[0]?.location;
    if (!location) {
      return interaction.reply({ embeds: [infoEmbed('Home location', 'You have no home location saved in this server.\nSet one with `/weather-home set location: Blairsville, PA`.')] });
    }
    return interaction.reply({ embeds: [infoEmbed('Home location', `Your home location in this server is **${location}**.`)] });
  },
};
