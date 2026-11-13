// Ticket helpers: DB records, permission checks, channel creation, close/reopen.
const errorLogger = require('./errorLogger');
// Ticket channels are deleted 60 seconds after closing (after the transcript
// is generated), unless reopened in that window — see reopenTicket().
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, PermissionsBitField,
} = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { generateTranscript } = require('./transcript');
const { infoEmbed, successEmbed } = require('./embeds');

const pendingDeletions = new Map(); // channelId -> timeout

async function getTicketByChannel(channelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1', [channelId]);
  return rows?.[0] || null;
}

async function createTicketRecord(guildId, channelId, userId, subject, panelId = null) {
  if (!db.isEnabled()) return null;
  try {
    await db.query(
      'INSERT INTO tickets (guild_id, channel_id, user_id, subject, status, panel_id) VALUES (?, ?, ?, ?, \'open\', ?)',
      [guildId, channelId, userId, subject, panelId || null],
    );
  } catch {
    // panel_id column not yet migrated — fall back to the legacy insert.
    await db.query(
      'INSERT INTO tickets (guild_id, channel_id, user_id, subject, status) VALUES (?, ?, ?, ?, \'open\')',
      [guildId, channelId, userId, subject],
    );
  }
  const rows = await db.query('SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1', [channelId]);
  return rows?.[0] || null;
}

// Multi-ticket panels (1.11.5): a guild can have several panels, each with
// its own category, staff role, and topic. The legacy single panel is the
// "default" panel (panel_id NULL).
async function createPanel(guildId, { channelId, categoryId, staffRoleId, title, description, createdBy }) {
  if (!db.isEnabled()) return null;
  const res = await db.query(
    'INSERT INTO ticket_panels (guild_id, channel_id, category_id, staff_role_id, title, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [guildId, channelId, categoryId || null, staffRoleId || null, title, description || null, createdBy || null],
  );
  const rows = await db.query('SELECT * FROM ticket_panels WHERE id = ?', [res.insertId]);
  return rows?.[0] || null;
}

async function listPanels(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id', [guildId])) || [];
}

async function getPanel(guildId, id) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM ticket_panels WHERE guild_id = ? AND id = ?', [guildId, id]);
  return rows?.[0] || null;
}

async function deletePanel(guildId, id) {
  if (!db.isEnabled()) return null;
  const panel = await getPanel(guildId, id);
  if (!panel) return null;
  await db.query('DELETE FROM ticket_panels WHERE id = ?', [id]);
  return panel;
}

async function nextTicketNumber(guildId) {
  if (!db.isEnabled()) return Math.floor(Math.random() * 9000) + 1000;
  const rows = await db.query('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ?', [guildId]);
  return (rows?.[0]?.n || 0) + 1;
}

function isSupport(member, ticket, settings) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (settings.ticketSupportRoleId && member.roles.cache.has(settings.ticketSupportRoleId)) return true;
  return false;
}

function canManageTicket(member, ticket, settings) {
  if (!ticket) return false;
  if (ticket.user_id === member.id) return true;
  return isSupport(member, ticket, settings);
}

function ticketPanelEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 ${title || 'Support Tickets'}`)
    .setDescription(description || 'Need help? Click **Create Ticket** below and tell us what\'s going on.\n\nA private channel will be created just for you and the support team.');
}

function ticketPanelRow(panelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(panelId ? `ticket_create:${panelId}` : 'ticket_create').setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
  );
}

function ticketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('ticket_add_user').setLabel('Add User').setStyle(ButtonStyle.Secondary).setEmoji('➕'),
  );
}

function ticketOpenEmbed(ticket, creatorTag) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 Ticket #${ticket?.id ?? '—'} — ${ticket?.subject || 'Support'}`)
    .setDescription(`Opened by **${creatorTag}** (<@${ticket?.user_id}>).\n\nPlease describe your issue and a staff member will be with you shortly.`)
    .addFields({ name: 'Subject', value: ticket?.subject || '—', inline: true });
}

async function createTicketChannel(guild, creator, subject, settings, opts = {}) {
  const number = await nextTicketNumber(guild.id);
  const name = `ticket-${creator.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${number}`.slice(0, 100);
  const categoryId = opts.categoryId || settings.ticketCategoryId;
  const supportRoleId = opts.supportRoleId || settings.ticketSupportRoleId;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: creator.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] },
  ];
  if (supportRoleId) {
    overwrites.push({ id: supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket for ${creator.tag} — ${subject}`,
  });
  return channel;
}

async function closeTicket(interaction, channel, ticket, reason, closedBy) {
  const settings = await getGuildSettings(channel.guildId);
  // Cancel any pending deletion (reopen path) — this is a fresh close.
  if (pendingDeletions.has(channel.id)) { clearTimeout(pendingDeletions.get(channel.id)); pendingDeletions.delete(channel.id); }

  // Lock the channel: only staff can still see/send.
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false }).catch(() => {});
  if (ticket?.user_id) {
    await channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});
  }

  // Transcript.
  let transcript = null;
  try { transcript = await generateTranscript(channel, ticket); } catch (err) { await errorLogger.log({ level: 'error', guildId: channel.guildId, commandName: 'ticket-close', message: `Transcript failed: ${err.message}`, stack: err.stack }); }

  if (db.isEnabled() && ticket) {
    await db.query(
      "UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, transcript_path = ? WHERE id = ?",
      [transcript?.filePath || null, ticket.id],
    );
    // Index the transcript for the Staff → Transcripts dashboard page.
    if (transcript?.filePath) {
      const { indexTranscript } = require('./transcripts');
      await indexTranscript({
        guildId: channel.guildId, ticketId: ticket.id, userId: ticket.user_id,
        closedBy: closedBy?.id || null, filePath: transcript.filePath,
      }).catch(() => {});
    }
  }

  // Send transcript to the ticket log channel + DM the creator.
  const logChannelId = settings.ticketLogChannelId;
  if (logChannelId) {
    const logChannel = channel.guild.channels.cache.get(logChannelId)
      || await channel.guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      const reopenRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_reopen:${channel.id}`).setLabel('Reopen Ticket').setStyle(ButtonStyle.Success).setEmoji('🔓'),
      );
      const files = transcript ? [{ attachment: transcript.filePath, name: transcript.filename }] : [];
      await logChannel.send({
        embeds: [infoEmbed(`📄 Ticket closed — #${channel.name}`, `Closed by ${closedBy.tag}. Reason: ${reason || 'No reason given'}. ${transcript ? `${transcript.messageCount} messages in transcript.` : 'Transcript unavailable.'}\nReopen within 60 seconds before the channel is deleted.`)],
        files,
        components: [reopenRow],
      }).catch(() => {});
    }
  }
  if (ticket?.user_id && transcript) {
    const creator = await channel.guild.members.fetch(ticket.user_id).catch(() => null);
    if (creator) {
      await creator.send({ embeds: [infoEmbed('Ticket closed', `Your ticket **#${channel.name}** was closed. Here's the transcript:`)], files: [{ attachment: transcript.filePath, name: transcript.filename }] }).catch(() => {});
    }
  }

  await channel.send({ embeds: [infoEmbed('Ticket closed', `🔒 This ticket was closed by ${closedBy.tag}. Reason: ${reason || 'No reason given'}. The channel will be deleted in 60 seconds unless reopened.`)] }).catch(() => {});

  // Delete after 60s unless reopened.
  const timeout = setTimeout(() => {
    pendingDeletions.delete(channel.id);
    channel.delete('Ticket closed').catch(() => {});
  }, 60_000);
  pendingDeletions.set(channel.id, timeout);
  return transcript;
}

async function reopenTicket(channel, ticket, reopenedBy) {
  if (pendingDeletions.has(channel.id)) { clearTimeout(pendingDeletions.get(channel.id)); pendingDeletions.delete(channel.id); }
  if (ticket?.user_id) {
    await channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
  }
  if (db.isEnabled() && ticket) {
    await db.query("UPDATE tickets SET status = 'open', closed_at = NULL WHERE id = ?", [ticket.id]);
  }
  await channel.send({ embeds: [successEmbed('Ticket reopened', `🔓 This ticket was reopened by ${reopenedBy.tag}.`)] }).catch(() => {});
}

module.exports = {
  getTicketByChannel, createTicketRecord, nextTicketNumber,
  isSupport, canManageTicket,
  ticketPanelEmbed, ticketPanelRow, ticketControlRow, ticketOpenEmbed,
  createTicketChannel, closeTicket, reopenTicket, pendingDeletions,
  createPanel, listPanels, getPanel, deletePanel,
};
