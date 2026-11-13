// Event scheduler (1.7.2): staff create events, members RSVP with buttons,
// RSVP'd members get a DM reminder 1 hour before (channel mention fallback
// if DMs are closed) and a "starting now" post in the channel.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('./database');
const { infoEmbed, successEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const RSVP_LABELS = { going: '✅ Going', maybe: '🤔 Maybe', not_going: "❌ Can't go" };

function eventEmbed(event, counts) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📅 ${event.title}`)
    .setDescription(event.description || '*No description.*')
    .addFields([
      { name: 'Starts', value: `<t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:R>)`, inline: false },
      { name: 'RSVPs', value: `✅ ${counts.going} going · 🤔 ${counts.maybe} maybe · ❌ ${counts.not_going} can't go`, inline: false },
    ])
    .setFooter({ text: `Event #${event.id} • Created by ${event.created_by ? `<@${event.created_by}>` : 'staff'}` })
    .setTimestamp(new Date(event.starts_at));
  return embed;
}

function eventRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event:going:${eventId}`).setLabel('✅ Going').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`event:maybe:${eventId}`).setLabel('🤔 Maybe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`event:not_going:${eventId}`).setLabel("❌ Can't go").setStyle(ButtonStyle.Danger),
  );
}

async function getEvent(eventId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM scheduled_events WHERE id = ?', [eventId]);
  return rows?.[0] || null;
}

async function getRsvpCounts(eventId) {
  if (!db.isEnabled()) return { going: 0, maybe: 0, not_going: 0 };
  const rows = await db.query("SELECT status, COUNT(*) AS n FROM event_rsvps WHERE event_id = ? GROUP BY status", [eventId]) || [];
  const counts = { going: 0, maybe: 0, not_going: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

async function setRsvp(eventId, userId, status) {
  await db.query(
    'INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
    [eventId, userId, status],
  );
}

async function createEvent(guildId, channelId, title, description, startsAt, createdBy) {
  const res = await db.query(
    'INSERT INTO scheduled_events (guild_id, channel_id, title, description, starts_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, channelId, title, description || null, startsAt, createdBy],
  );
  return res.insertId;
}

async function listUpcomingEvents(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    "SELECT * FROM scheduled_events WHERE guild_id = ? AND status = 'upcoming' AND starts_at > NOW() ORDER BY starts_at LIMIT ?",
    [guildId, limit],
  )) || [];
}

async function cancelEvent(eventId) {
  await db.query("UPDATE scheduled_events SET status = 'cancelled' WHERE id = ?", [eventId]);
}

async function refreshEventMessage(client, event) {
  try {
    const channel = await client.channels.fetch(event.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(event.message_id).catch(() => null);
    if (!msg) return;
    const counts = await getRsvpCounts(event.id);
    await msg.edit({ embeds: [eventEmbed(event, counts)], components: [eventRow(event.id)] }).catch(() => {});
  } catch {}
}

// Timer: every minute — send 1-hour reminders and "starting now" posts.
function startEventChecker(client) {
  const tick = async () => {
    if (!db.isEnabled()) return;
    try {
      const now = new Date();
      // 1-hour reminders (once per event).
      const due = await db.query(
        "SELECT * FROM scheduled_events WHERE status = 'upcoming' AND reminded = 0 AND starts_at <= DATE_ADD(NOW(), INTERVAL 1 HOUR) AND starts_at > NOW()",
      ) || [];
      for (const event of due) {
        await db.query('UPDATE scheduled_events SET reminded = 1 WHERE id = ?', [event.id]);
        const rsvps = await db.query("SELECT user_id FROM event_rsvps WHERE event_id = ? AND status IN ('going','maybe')", [event.id]) || [];
        const guild = client.guilds.cache.get(event.guild_id) || await client.guilds.fetch(event.guild_id).catch(() => null);
        const channel = guild ? (guild.channels.cache.get(event.channel_id) || await guild.channels.fetch(event.channel_id).catch(() => null)) : null;
        let dmFailed = [];
        for (const r of rsvps) {
          const member = guild ? await guild.members.fetch(r.user_id).catch(() => null) : null;
          if (!member) continue;
          await member.send({ embeds: [infoEmbed('📅 Event in 1 hour', `**${event.title}** starts <t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:R> in **${guild.name}** (<#${event.channel_id}>).`)] })
            .catch(() => { dmFailed.push(r.user_id); });
        }
        if (dmFailed.length && channel?.isTextBased()) {
          await channel.send({ content: `⏰ **${event.title}** starts in 1 hour! ${dmFailed.map((id) => `<@${id}>`).join(' ')} (couldn't DM you)` }).catch(() => {});
        }
      }
      // Starting now.
      const starting = await db.query(
        "SELECT * FROM scheduled_events WHERE status = 'upcoming' AND starts_at <= NOW()",
      ) || [];
      for (const event of starting) {
        await db.query("UPDATE scheduled_events SET status = 'started' WHERE id = ?", [event.id]);
        const channel = await client.channels.fetch(event.channel_id).catch(() => null);
        if (!channel?.isTextBased()) continue;
        const counts = await getRsvpCounts(event.id);
        const rsvps = await db.query("SELECT user_id FROM event_rsvps WHERE event_id = ? AND status IN ('going','maybe')", [event.id]) || [];
        await channel.send({
          content: rsvps.length ? `🎉 **${event.title}** is starting now! ${rsvps.map((r) => `<@${r.user_id}>`).join(' ')}` : `🎉 **${event.title}** is starting now!`,
          embeds: [eventEmbed({ ...event, status: 'started' }, counts)],
        }).catch(() => {});
      }
    } catch (e) {
      errorLogger.log({ level: 'error', commandName: 'event', message: `Event checker tick failed: ${e.message}`, stack: e.stack });
    }
  };
  tick();
  setInterval(tick, 60_000);
}

module.exports = {
  RSVP_LABELS, eventEmbed, eventRow, getEvent, getRsvpCounts, setRsvp,
  createEvent, listUpcomingEvents, cancelEvent, refreshEventMessage, startEventChecker,
};
