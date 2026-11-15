const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/database');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const MAX_EMOJI_BYTES = 256 * 1024;
const NAME_RE = /^[a-zA-Z0-9_]{2,32}$/;
const CUSTOM_EMOJI_RE = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>$/;

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
  return buf;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('steal-emoji')
    .setDescription('Add a custom emoji from another server (or an image URL) to this server.')
    .addStringOption((o) => o.setName('emoji').setDescription('Custom emoji (<:name:id> or <a:name:id>) or a direct image URL').setRequired(true))
    .addStringOption((o) => o.setName('name').setDescription('Name for the emoji (2–32 letters, numbers, underscores) — defaults to the original name'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers),
  async execute(interaction) {
    const input = interaction.options.getString('emoji').trim();
    const nameOpt = interaction.options.getString('name');
    let name = nameOpt || null;
    let imageUrl = null;
    let animated = false;

    const custom = CUSTOM_EMOJI_RE.exec(input);
    if (custom) {
      animated = custom[1] === 'a';
      if (!name) name = custom[2];
      imageUrl = `https://cdn.discordapp.com/emojis/${custom[3]}.${animated ? 'gif' : 'png'}`;
    } else if (/^https?:\/\//i.test(input)) {
      imageUrl = input;
      if (!name) {
        return interaction.reply({ embeds: [errorEmbed('Name needed', 'When stealing from an image URL, give a `name` for the emoji (2–32 letters, numbers, underscores).')] });
      }
    } else {
      return interaction.reply({ embeds: [errorEmbed('Not a custom emoji', 'Give a custom emoji like `<:name:id>` (or `<a:name:id>` for animated) or a direct image URL. Unicode emoji can\'t be stolen.')] });
    }

    if (!NAME_RE.test(name)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid name', 'Emoji names must be 2–32 characters, letters, numbers, and underscores only.')] });
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
      image = await fetchImage(imageUrl);
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Could not fetch image', err.message)] });
    }
    try {
      const emoji = await interaction.guild.emojis.create({ attachment: image, name });
      await logEmoji(interaction.guildId, interaction.user.id, 'add', name);
      return interaction.editReply({ embeds: [successEmbed('Emoji stolen', `${emoji} \`:${name}:\` is now available in this server.`)] });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Upload failed', err.message || 'Discord rejected the emoji. Check the image format and the server emoji limit.')] });
    }
  },
};
