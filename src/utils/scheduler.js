// Scheduled messages + reminders: a 1-minute loop that sends anything
// due and marks it sent. Everything lives in MySQL, so scheduled items
// survive restarts. Started once from the ClientReady event
// (src/events/premiumReady.js).
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const { infoEmbed } = require('./embeds');

let started = false;

async function checkDue(client) {
  if (!db.isEnabled()) return;

  // --- Scheduled messages ---
  const dueMessages = await db.query(
    "SELECT * FROM scheduled_messages WHERE sent = 0 AND send_at <= NOW() ORDER BY send_at LIMIT 20",
  ) || [];
  for (const row of dueMessages) {
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        if (row.embed_json) {
          let embedData = null;
          try { embedData = JSON.parse(row.embed_json); } catch {}
          if (embedData) await channel.send({ content: row.content || undefined, embeds: [EmbedBuilder.from(embedData)] });
          else if (row.content) await channel.send({ content: row.content });
        } else if (row.content) {
          await channel.send({ content: row.content });
        }
      }
    } catch {}
    await db.query('UPDATE scheduled_messages SET sent = 1 WHERE id = ?', [row.id]);
  }

  // --- Reminders ---
  const dueReminders = await db.query(
    "SELECT * FROM reminders WHERE sent = 0 AND remind_at <= NOW() ORDER BY remind_at LIMIT 20",
  ) || [];
  for (const row of dueReminders) {
    let delivered = false;
    try {
      const user = await client.users.fetch(row.user_id).catch(() => null);
      if (user) {
        await user.send({ embeds: [infoEmbed('⏰ Reminder', row.text)] });
        delivered = true;
      }
    } catch {}
    if (!delivered && row.channel_id) {
      // DMs closed — fall back to the channel where it was set.
      try {
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (channel?.isTextBased()) {
          await channel.send({ content: `<@${row.user_id}>`, embeds: [infoEmbed('⏰ Reminder', `${row.text}\n\n*(Your DMs are closed, so this was posted here instead.)`)] });
          delivered = true;
        }
      } catch {}
    }
    await db.query('UPDATE reminders SET sent = 1 WHERE id = ?', [row.id]);
  }
}

function startScheduler(client) {
  if (started) return;
  started = true;
  setInterval(() => checkDue(client).catch(() => {}), 60_000);
}

module.exports = { startScheduler, checkDue };
