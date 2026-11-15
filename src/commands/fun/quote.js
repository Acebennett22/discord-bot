const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

function parseMessageRef(ref, guildId) {
  // Accept a message ID or a Discord message link.
  const link = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/.exec(ref || '');
  if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
  if (/^\d{15,25}$/.test(ref || '')) return { guildId, channelId: null, messageId: ref };
  return null;
}

function quoteEmbed(quote, author, quoter, channelId) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: author?.tag || 'Unknown user', iconURL: author?.displayAvatarURL?.() || null })
    .setDescription(`"${quote.content}"`)
    .addFields(
      { name: 'Quoted by', value: quoter ? `<@${quoter.id}>` : '—', inline: true },
      { name: 'Original', value: `[Jump to message](https://discord.com/channels/${quote.guild_id}/${channelId}/${quote.message_id})`, inline: true },
    )
    .setFooter({ text: `Quote #${quote.id} · ${new Date(quote.created_at).toLocaleDateString()}` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Save a message as a quote and repost it as a fancy embed.')
    .addStringOption((o) => o.setName('message').setDescription('Message ID or message link').setRequired(true)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Quotes need MySQL.')] });
    const ref = parseMessageRef(interaction.options.getString('message'), interaction.guildId);
    if (!ref) return interaction.reply({ embeds: [errorEmbed('Invalid message', 'Give a message ID or a full Discord message link.')] });
    if (ref.guildId !== interaction.guildId) return interaction.reply({ embeds: [errorEmbed('Different server', 'You can only quote messages from this server.')] });
    const channel = ref.channelId
      ? interaction.guild.channels.cache.get(ref.channelId) || await interaction.guild.channels.fetch(ref.channelId).catch(() => null)
      : null;
    const msg = channel
      ? await channel.messages.fetch(ref.messageId).catch(() => null)
      : await interaction.channel.messages.fetch(ref.messageId).catch(() => null);
    if (!msg) return interaction.reply({ embeds: [errorEmbed('Message not found', 'I couldn\'t find that message — check the ID/link and that I can read that channel.')] });
    // Guard: the quoter must be able to read the channel.
    const targetChannel = msg.channel;
    if (!targetChannel.permissionsFor(interaction.member)?.has('ViewChannel')) {
      return interaction.reply({ embeds: [errorEmbed('No access', 'You can\'t quote messages from a channel you can\'t read.')] });
    }
    if (msg.author.id === interaction.client.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Can\'t quote the bot', 'Quoting the bot\'s own messages isn\'t allowed.')] });
    }
    const content = (msg.content || '*[no text / embed only]*').slice(0, 2000);
    const existing = await db.query('SELECT * FROM quotes WHERE guild_id = ? AND message_id = ?', [interaction.guildId, msg.id]);
    if (existing?.length) {
      const q = existing[0];
      return interaction.reply({ embeds: [quoteEmbed(q, msg.author, interaction.user, msg.channelId)], content: `That message is already quote #${q.id}.` });
    }
    const res = await db.query(
      'INSERT INTO quotes (guild_id, message_id, channel_id, author_id, content, quoted_by) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.guildId, msg.id, msg.channelId, msg.author.id, content, interaction.user.id],
    );
    const rows = await db.query('SELECT * FROM quotes WHERE id = ?', [res.insertId]);
    const quote = rows[0];
    // The quote embed itself is public — that's the point.
    await interaction.reply({ embeds: [quoteEmbed(quote, msg.author, interaction.user, msg.channelId)] });
    return;
  },
};
