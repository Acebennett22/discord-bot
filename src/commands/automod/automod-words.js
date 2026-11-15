const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const automod = require('../../utils/automod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod-words')
    .setDescription('Admin only: manage the banned-words list.')
    .addSubcommand((s) => s.setName('add').setDescription('Add a banned word').addStringOption((o) => o.setName('word').setDescription('Word to ban').setRequired(true).setMaxLength(64)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a banned word').addStringOption((o) => o.setName('word').setDescription('Word to remove').setRequired(true).setMaxLength(64)))
    .addSubcommand((s) => s.setName('list').setDescription('List all banned words'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    const sub = interaction.options.getSubcommand();
    const settings = await automod.getSettings(interaction.guildId);
    if (sub === 'list') {
      return interaction.reply({
        embeds: [infoEmbed('🛡️ Banned words', settings.bannedWords.length ? settings.bannedWords.join(', ') : 'No banned words set. Add one with /automod-words add.')],
      });
    }
    const word = interaction.options.getString('word').trim().toLowerCase();
    if (!word) return interaction.reply({ embeds: [errorEmbed('Empty word', 'Give a word to add or remove.')] });
    let words = [...settings.bannedWords];
    if (sub === 'add') {
      if (words.includes(word)) return interaction.reply({ embeds: [errorEmbed('Already banned', `"${word}" is already on the banned-words list.`)] });
      words.push(word);
    } else {
      if (!words.includes(word)) return interaction.reply({ embeds: [errorEmbed('Not on the list', `"${word}" is not on the banned-words list.`)] });
      words = words.filter((w) => w !== word);
    }
    await automod.setSettings(interaction.guildId, { bannedWords: words });
    return interaction.reply({ embeds: [successEmbed(sub === 'add' ? 'Word banned' : 'Word removed', sub === 'add' ? `"${word}" will now trigger Automod (word-boundary match).` : `"${word}" was removed from the banned-words list.`)] });
  },
};
