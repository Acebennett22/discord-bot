const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/database');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const MAX_EMOJI_BYTES = 256 * 1024;
const NAME_RE = /^[a-zA-Z0-9_]{2,32}$/;

async function logEmoji(guildId, userId, action, name) {
  if (!db.isEnabled()) return;
  await db.query('INSERT INTO emoji_logs (guild_id, user_id, action, emoji_name) VALUES (?, ?, ?, ?)', [guildId, userId, action, name]).catch(() => {});
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/^image\/(png|jpe?g|gif|webp)/.test(type)) throw new Error(`Not an image (content-type: ${type || 'unknown'}).`);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > MAX_EMOJI_BYTES) throw new Error(`Image is ${Math.round(len / 1024)}KB — Discord emoji must be under 256KB.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_EMOJI_BYTES) throw new Error(`Image is ${Math.round(buf.length / 1024)}KB — Discord emoji must be under 256KB.`);
  return { buffer: buf, type };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji-add')
    .setDescription('Admin only: upload a custom emoji to this server.')
    .addStringOption((o) => o.setName('name').setDescription('Emoji name (2–32 letters, numbers, underscores)').setRequired(true))
    .addAttachmentOption((o) => o.setName('image').setDescription('Image file (PNG/JPG/GIF, under 256KB)'))
    .addStringOption((o) => o.setName('image_url').setDescription('...or an image URL instead of an upload'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers),
  async execute(interaction) {
    const name = interaction.options.getString('name');
    const attachment = interaction.options.getAttachment('image');
    const url = interaction.options.getString('image_url');
    if (!NAME_RE.test(name)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid name', 'Emoji names must be 2–32 characters, letters, numbers, and underscores only.')] });
    }
    if (!attachment && !url) {
      return interaction.reply({ embeds: [errorEmbed('No image', 'Attach an image or give an `image_url`.')] });
    }
    const limit = interaction.guild.emojiLimit || 50;
    if (interaction.guild.emojis.cache.size >= limit) {
      return interaction.reply({ embeds: [errorEmbed('Emoji slots full', `This server already has ${interaction.guild.emojis.cache.size}/${limit} custom emoji — remove one first with \`/emoji-remove\`.`)]  });
    }
    if (interaction.guild.emojis.cache.some((e) => e.name === name)) {
      return interaction.reply({ embeds: [errorEmbed('Name taken', `An emoji named \`:${name}:\` already exists in this server.`)] });
    }
    await interaction.deferReply();
    let image;
    try {
      if (attachment) {
        if (!/^image\//.test(attachment.contentType || '')) throw new Error('Attachment is not an image.');
        if (attachment.size > MAX_EMOJI_BYTES) throw new Error(`Image is ${Math.round(attachment.size / 1024)}KB — Discord emoji must be under 256KB.`);
        image = attachment.url;
      } else {
        const fetched = await fetchImage(url);
        image = fetched.buffer;
      }
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Could not fetch image', err.message)] });
    }
    try {
      const emoji = await interaction.guild.emojis.create({ attachment: image, name });
      await logEmoji(interaction.guildId, interaction.user.id, 'add', name);
      return interaction.editReply({ embeds: [successEmbed('Emoji added', `${emoji} \`:${name}:\` is now available in this server.`)] });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Upload failed', err.message || 'Discord rejected the emoji. Check the image format and the server emoji limit.')] });
    }
  },
};
