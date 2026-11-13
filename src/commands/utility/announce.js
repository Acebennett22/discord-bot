const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const config = require('../../utils/config');
const { logWarn } = require('../../utils/errorLogger');

// Admin-only announcement command (Manage Guild, same gate as the
// moderation commands use via setDefaultMemberPermissions + runtime check).
// Posts a rich embed (or a plain-text fallback) in the chosen channel.

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;
const IMAGE_URL = /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i;

function parseColor(raw) {
  if (!raw) return config.embedColor || '#5865F2';
  if (!HEX_COLOR.test(raw.trim())) return null; // invalid -> caller falls back
  const hex = raw.trim().replace(/^#/, '');
  return `#${hex}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Admin only: post an announcement embed in a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the announcement in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Announcement title').setRequired(true).setMaxLength(256))
    .addStringOption((o) => o.setName('description').setDescription('Announcement body').setRequired(true).setMaxLength(4000))
    .addStringOption((o) => o.setName('color').setDescription('Embed color as a hex code, e.g. #5865F2'))
    .addStringOption((o) => o.setName('image').setDescription('Image URL to show in the embed (must be http(s) and an image file)'))
    .addStringOption((o) => o.setName('footer').setDescription('Footer text for the embed').setMaxLength(2048))
    .addRoleOption((o) => o.setName('ping').setDescription('Role to ping with the announcement'))
    .addBooleanOption((o) => o.setName('plain').setDescription('Send as plain text instead of an embed'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to post announcements.')], ephemeral: true });
    }
    if (!interaction.guild) {
      return interaction.reply({ embeds: [errorEmbed('Server only', 'Announcements can only be posted in a server.')], ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const footer = interaction.options.getString('footer');
    const plain = interaction.options.getBoolean('plain') || false;
    const pingRole = interaction.options.getRole('ping');
    const imageRaw = interaction.options.getString('image');
    const colorRaw = interaction.options.getString('color');

    // Validate color: invalid hex falls back to the configured embedColor.
    let color = parseColor(colorRaw);
    let colorNote = '';
    if (colorRaw && color === null) {
      color = config.embedColor || '#5865F2';
      colorNote = `\n⚠️ "${colorRaw}" is not a valid hex color, so the default embed color was used.`;
    }

    // Validate image URL.
    if (imageRaw && !IMAGE_URL.test(imageRaw.trim())) {
      return interaction.reply({ embeds: [errorEmbed('Invalid image URL', 'The image must be an http(s) URL ending in .png, .jpg, .jpeg, .gif or .webp.')], ephemeral: true });
    }
    const image = imageRaw ? imageRaw.trim() : null;

    // The ping role must be mentionable by the bot.
    const me = interaction.guild.members.me;
    if (pingRole && !pingRole.mentionable && !me?.permissions.has(PermissionFlagsBits.MentionEveryone)) {
      return interaction.reply({ embeds: [errorEmbed('Role cannot be pinged', `I can't mention **${pingRole.name}** — that role is not mentionable and I don't have the Mention Everyone permission. Make the role mentionable or give me that permission and try again.`)], ephemeral: true });
    }

    // The bot must be able to send (and embed, for embed mode) in the channel.
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ embeds: [errorEmbed('Cannot post there', `I don't have permission to send messages in ${channel}.`)], ephemeral: true });
    }
    if (!plain && !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({ embeds: [errorEmbed('Cannot post there', `I need the Embed Links permission in ${channel} to post an embed — or use the plain option instead.`)], ephemeral: true });
    }

    const pingText = pingRole ? `${pingRole}` : '';
    try {
      let sent;
      if (plain) {
        const content = `${pingText ? `${pingText}\n` : ''}**${title}**\n\n${description}`;
        sent = await channel.send({ content });
      } else {
        const embed = infoEmbed(title, description).setColor(color);
        if (image) embed.setImage(image);
        if (footer) embed.setFooter({ text: footer });
        sent = await channel.send({ content: pingText || undefined, embeds: [embed] });
      }
      const link = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${sent.id}`;
      return interaction.reply({
        embeds: [successEmbed('Announcement posted', `Posted in ${channel} — [jump to message](${link}).${colorNote}`)],
        ephemeral: true,
      });
    } catch (err) {
      await logWarn('announce: failed to send announcement', { commandName: 'announce', error: err.message });
      return interaction.reply({ embeds: [errorEmbed('Announcement failed', `I couldn't post in ${channel} — check my permissions there and try again. (${err.message})`)], ephemeral: true });
    }
  },
};
