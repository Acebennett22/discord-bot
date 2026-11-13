// Modmail (1.4.6): users DM the bot, staff answer from a thread channel.
// Which guild? The bot is in many servers — a DM is routed to the first
// guild (in join order) where the user is a member and modmail is enabled.
// Threads are private channels in the configured category, visible only to
// staff (everyone denied) plus the support role if set.
const { ChannelType, PermissionsBitField } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');

async function findModmailGuild(client, userId) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await getGuildSettings(guild.id).catch(() => null);
    if (!settings?.modmailEnabled) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) return { guild, member, settings };
  }
  return null;
}

async function isBlocked(guildId, userId) {
  if (!db.isEnabled()) return false;
  const rows = await db.query('SELECT 1 FROM modmail_blocks WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return Boolean(rows?.length);
}

async function getOpenThread(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query("SELECT * FROM modmail_threads WHERE guild_id = ? AND user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", [guildId, userId]);
  return rows?.[0] || null;
}

async function openThread(client, guild, member, settings, user) {
  const name = `modmail-${user.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}`.slice(0, 100);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] },
  ];
  if (settings.ticketSupportRoleId) {
    overwrites.push({ id: settings.ticketSupportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({
    name, type: ChannelType.GuildText,
    parent: settings.modmailCategoryId || undefined,
    permissionOverwrites: overwrites,
    topic: `Modmail thread for ${user.tag} (${user.id})`,
  });
  await db.query(
    'INSERT INTO modmail_threads (guild_id, user_id, channel_id, status) VALUES (?, ?, ?, \'open\')',
    [guild.id, user.id, channel.id],
  );
  const rows = await db.query('SELECT * FROM modmail_threads WHERE channel_id = ? ORDER BY id DESC LIMIT 1', [channel.id]);
  const thread = rows?.[0];
  await channel.send({ embeds: [infoEmbed(`📬 Modmail — ${user.tag}`, `Opened by **${user.tag}** (<@${user.id}>).\n\nReply in this channel to message them back. Close with /modmail-close.`) ] }).catch(() => {});
  return thread;
}

async function relayDmToThread(client, message) {
  const found = await findModmailGuild(client, message.author.id);
  if (!found) return { handled: false };
  const { guild, settings } = found;
  if (await isBlocked(guild.id, message.author.id)) {
    await message.author.send('You are blocked from using modmail in this server.').catch(() => {});
    return { handled: true };
  }
  let thread = await getOpenThread(guild.id, message.author.id);
  if (!thread) thread = await openThread(client, guild, found.member, settings, message.author);
  if (!thread?.channel_id) return { handled: false };
  const channel = await guild.channels.fetch(thread.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return { handled: false };
  await db.query(
    'INSERT INTO modmail_messages (thread_id, author_id, author_type, content) VALUES (?, ?, \'user\', ?)',
    [thread.id, message.author.id, message.content.slice(0, 4000)],
  ).catch(() => {});
  await channel.send({ embeds: [infoEmbed(`📩 ${message.author.tag}`, message.content.slice(0, 4000) || '(attachment only)')] }).catch(() => {});
  return { handled: true };
}

async function relayThreadToDm(client, message) {
  if (!db.isEnabled()) return false;
  const rows = await db.query("SELECT * FROM modmail_threads WHERE channel_id = ? AND status = 'open'", [message.channelId]);
  const thread = rows?.[0];
  if (!thread) return false;
  const user = await client.users.fetch(thread.user_id).catch(() => null);
  if (!user) return false;
  await db.query(
    'INSERT INTO modmail_messages (thread_id, author_id, author_type, content) VALUES (?, ?, \'staff\', ?)',
    [thread.id, message.author.id, message.content.slice(0, 4000)],
  ).catch(() => {});
  await user.send({ embeds: [infoEmbed(`📬 Staff reply — ${message.guild.name}`, message.content.slice(0, 4000) || '(attachment only)')] }).catch(() => {});
  return true;
}

async function closeThread(client, guild, thread, closedBy, reason) {
  await db.query("UPDATE modmail_threads SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?", [closedBy?.id || null, thread.id]);
  const user = await client.users.fetch(thread.user_id).catch(() => null);
  if (user) {
    await user.send({ embeds: [infoEmbed(`📬 Modmail closed — ${guild.name}`, `Your modmail thread has been closed.${reason ? `\nReason: ${reason}` : ''}\n\nDM the bot again if you need anything else.`)] }).catch(() => {});
  }
  const channel = await guild.channels.fetch(thread.channel_id).catch(() => null);
  if (channel) {
    await channel.send({ embeds: [infoEmbed('Thread closed', `Closed by ${closedBy?.tag || 'staff'}.${reason ? ` Reason: ${reason}` : ''} The channel will be deleted shortly.`)] }).catch(() => {});
    setTimeout(() => channel.delete('Modmail thread closed').catch(() => {}), 30_000);
  }
  return true;
}

module.exports = { findModmailGuild, isBlocked, getOpenThread, openThread, relayDmToThread, relayThreadToDm, closeThread };
