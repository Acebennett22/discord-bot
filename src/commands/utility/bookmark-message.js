const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const bookmarks = require('../../utils/bookmarks');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Bookmark message')
    .setType(ApplicationCommandType.Message),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bookmarks need MySQL.')] });
    const message = interaction.targetMessage;
    if (!message) return interaction.reply({ embeds: [errorEmbed('Not found', 'Could not read that message.')] });
    const id = await bookmarks.addBookmark(interaction.guildId, interaction.user.id, message, null);
    return interaction.reply({ embeds: [successEmbed('Bookmarked', `Saved as bookmark **#${id}**. See your list with /bookmark list.`)] });
  },
};
