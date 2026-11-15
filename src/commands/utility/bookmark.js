const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const bookmarks = require('../../utils/bookmarks');

function parseMessageRef(ref) {
  const link = /discord\.com\/channels\/\d+\/(\d+)\/(\d+)/.exec(ref || '');
  if (link) return { channelId: link[1], messageId: link[2] };
  if (/^\d{17,20}$/.test((ref || '').trim())) return { channelId: null, messageId: ref.trim() };
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bookmark')
    .setDescription('Save messages to your own bookmark list.')
    .addSubcommand((s) => s.setName('add').setDescription('Save a message to your bookmarks.')
      .addStringOption((o) => o.setName('message').setDescription('Message ID or message link').setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('A note for yourself').setMaxLength(256)))
    .addSubcommand((s) => s.setName('list').setDescription('List your bookmarks.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove one of your bookmarks.')
      .addIntegerOption((o) => o.setName('id').setDescription('Bookmark ID (from /bookmark list)').setRequired(true))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bookmarks need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await bookmarks.listBookmarks(interaction.guildId, interaction.user.id, 25);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🔖 Your bookmarks', 'No bookmarks yet. Use /bookmark add, or right-click a message → Apps → Bookmark message.')], ephemeral: true });
      const lines = rows.map((b) => `**#${b.id}** — <@${b.author_id || 'unknown'}> in <#${b.channel_id}> — [jump](${bookmarks.jumpLink(interaction.guildId, b.channel_id, b.message_id)})${b.note ? `\n> ${b.note.slice(0, 120)}` : ''}${b.content_excerpt ? `\n> ${(b.content_excerpt || '').slice(0, 120)}` : ''}`);
      return interaction.reply({ embeds: [infoEmbed('🔖 Your bookmarks', lines.join('\n\n'))], ephemeral: true });
    }
    if (sub === 'remove') {
      const removed = await bookmarks.removeBookmark(interaction.guildId, interaction.user.id, interaction.options.getInteger('id'));
      if (!removed) return interaction.reply({ embeds: [infoEmbed('Not found', 'No bookmark with that ID in your list.')] });
      return interaction.reply({ embeds: [successEmbed('Bookmark removed', 'Done.')] });
    }
    // add
    const ref = parseMessageRef(interaction.options.getString('message'));
    if (!ref) return interaction.reply({ embeds: [errorEmbed('Bad reference', 'Give a message ID or a full Discord message link.')] });
    let channel = ref.channelId
      ? (interaction.guild.channels.cache.get(ref.channelId) || await interaction.guild.channels.fetch(ref.channelId).catch(() => null))
      : interaction.channel;
    if (!channel?.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Not found', 'I could not find that channel.')] });
    const message = await channel.messages.fetch(ref.messageId).catch(() => null);
    if (!message) return interaction.reply({ embeds: [errorEmbed('Not found', 'I could not read that message — it may be in a channel you cannot see, or it was deleted.')] });
    const id = await bookmarks.addBookmark(interaction.guildId, interaction.user.id, message, interaction.options.getString('note'));
    return interaction.reply({ embeds: [successEmbed('Bookmarked', `Saved as bookmark **#${id}**. See your list with /bookmark list.`)] });
  },
};
