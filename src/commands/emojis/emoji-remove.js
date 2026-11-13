const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/database');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji-remove')
    .setDescription('Admin only: remove a custom emoji from this server.')
    .addStringOption((o) => o.setName('name').setDescription('Name of the emoji to remove (without colons)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers),
  async execute(interaction) {
    const name = interaction.options.getString('name').replace(/:/g, '');
    const emoji = interaction.guild.emojis.cache.find((e) => e.name === name);
    if (!emoji) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `No custom emoji named \`:${name}:\` in this server. See them all with \`/emoji-list\`.`)] , ephemeral: true });
    }
    await emoji.delete('Removed via /emoji-remove').catch((err) => { throw err; });
    if (db.isEnabled()) {
      await db.query('INSERT INTO emoji_logs (guild_id, user_id, action, emoji_name) VALUES (?, ?, ?, ?)', [interaction.guildId, interaction.user.id, 'remove', name]).catch(() => {});
    }
    return interaction.reply({ embeds: [successEmbed('Emoji removed', `\`:${name}:\` has been removed from this server.`)] , ephemeral: true });
  },
};
