const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { parseTime, discordTimestamp } = require('../../utils/timeParse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Admin only: schedule a message to be posted later.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName('time').setDescription('When: "in 2h", "tomorrow 9am", or "2026-11-14 15:00"').setRequired(true))
    .addStringOption((o) => o.setName('content').setDescription('Message text').setRequired(true).setMaxLength(2000))
    .addStringOption((o) => o.setName('title').setDescription('Optional: post as an embed with this title').setMaxLength(256))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Scheduled messages only work in a server.')], ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to schedule messages.')], ephemeral: true });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so messages can\'t be scheduled right now.')], ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    const sendAt = parseTime(interaction.options.getString('time'));
    if (!sendAt) {
      return interaction.reply({ embeds: [errorEmbed('Bad time', 'I couldn\'t understand that time. Try "in 2h", "tomorrow 9am", or "2026-11-14 15:00" — it must be in the future.')], ephemeral: true });
    }
    const content = interaction.options.getString('content');
    const title = interaction.options.getString('title');
    const embedJson = title ? JSON.stringify({ title, description: content, color: 0x5865f2 }) : null;
    const result = await db.query(
      'INSERT INTO scheduled_messages (guild_id, channel_id, author_id, content, embed_json, send_at) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.guildId, channel.id, interaction.user.id, embedJson ? null : content, embedJson, sendAt],
    );
    return interaction.reply({ embeds: [successEmbed('Message scheduled', `I'll post in ${channel} ${discordTimestamp(sendAt)} (ID #${result.insertId}).\nCancel it anytime with \`/schedule-cancel ${result.insertId}\`.`)] , ephemeral: true });
  },
};
