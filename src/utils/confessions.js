// Confessions (1.6.4): anonymous posts. The author is stored in the DB
// for moderation only and is NEVER shown publicly — posted confessions
// show only "Anonymous" + a number (#42). Staff approve/deny in the review
// queue (dashboard or buttons); approval can be turned off per server.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { getPremiumSettings } = require('./premiumSettings');

function confessionEmbed(confession) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🤫 Anonymous Confession #${confession.id}`)
    .setDescription(confession.content)
    .setFooter({ text: 'Posted anonymously' })
    .setTimestamp(new Date(confession.created_at));
}

async function postReviewQueue(client, guildId, confession) {
  // Staff review message in the modlog channel (if set) — the ONLY place
  // the author is visible, and only to staff who can read that channel.
  const premium = await getPremiumSettings(guildId).catch(() => null);
  if (!premium?.modlogChannelId) return;
  const channel = await client.channels.fetch(premium.modlogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`🤫 Confession #${confession.id} — awaiting review`)
    .setDescription(confession.content)
    .addFields({ name: 'Author (staff only — never public)', value: `<@${confession.user_id}>`, inline: true })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confess_approve:${confession.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`confess_deny:${confession.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
  );
  await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
}

async function postConfession(client, guildId, confession) {
  const settings = await getGuildSettings(guildId);
  if (!settings.confessionsChannelId) return { ok: false, error: 'No confessions channel is set.' };
  const channel = await client.channels.fetch(settings.confessionsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, error: 'Confessions channel not found.' };
  await channel.send({ embeds: [confessionEmbed(confession)] });
  return { ok: true };
}

async function submitConfession(client, guildId, userId, content) {
  const settings = await getGuildSettings(guildId);
  if (!settings.confessionsEnabled) return { ok: false, error: 'Confessions are not enabled in this server.' };
  const res = await db.query(
    'INSERT INTO confessions (guild_id, user_id, content, status) VALUES (?, ?, ?, ?)',
    [guildId, userId, content.slice(0, 2000), settings.confessionsRequireApproval ? 'pending' : 'approved'],
  );
  const rows = await db.query('SELECT * FROM confessions WHERE id = ?', [res.insertId]);
  const confession = rows[0];
  if (!settings.confessionsRequireApproval) {
    const posted = await postConfession(client, guildId, confession);
    if (!posted.ok) return { ok: false, error: posted.error };
    return { ok: true, posted: true, confession };
  }
  await postReviewQueue(client, guildId, confession).catch(() => {});
  return { ok: true, posted: false, confession };
}

module.exports = { confessionEmbed, postConfession, submitConfession };
