// Voice XP (1.4.3): track voice time per user.
// Anti-AFK-farm rules (documented in README): XP is only earned when the
// member is not deafened or muted, is not in the guild's AFK channel, and
// at least one other non-bot user is in the same voice channel. Sessions
// are recorded in voice_sessions; minutes are finalized on leave (or when
// the member stops qualifying) and fed into user_levels via awardVoiceXp.
// In-memory map holds open sessions so a restart doesn't award phantom time.
const db = require('./database');
const config = require('./config');
const { awardVoiceXp } = require('./leveling');
const { logWarn } = require('./errorLogger');

const openSessions = new Map(); // `${guildId}:${userId}` -> { joinedAt, channelId, qualifyingSince, minutesAwarded }

function key(guildId, userId) { return `${guildId}:${userId}`; }

function qualifies(member, channel) {
  if (!member || member.user.bot) return false;
  if (member.voice.deaf || member.voice.mute) return false;
  if (member.guild.afkChannelId && channel?.id === member.guild.afkChannelId) return false;
  const others = channel?.members?.filter((m) => !m.user.bot && m.id !== member.id) || [];
  return others.size >= 1;
}

async function finalizeSession(guild, member, channelId, reason) {
  const k = key(guild.id, member.id);
  const session = openSessions.get(k);
  if (!session) return;
  openSessions.delete(k);
  const now = Date.now();
  // Only count time while the member qualified (not muted/deafened/alone).
  const qualifyingMs = session.qualifyingSince ? now - session.qualifyingSince : 0;
  const minutes = Math.floor(qualifyingMs / 60_000);
  if (!db.isEnabled()) return;
  await db.query(
    'INSERT INTO voice_sessions (guild_id, user_id, joined_at, left_at, minutes) VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?)',
    [guild.id, member.id, Math.floor(session.joinedAt / 1000), Math.floor(now / 1000), minutes],
  ).catch(() => {});
  if (minutes > 0) {
    await awardVoiceXp(guild, member, minutes).catch((e) => logWarn('voice XP award failed', { guildId: guild.id, userId: member.id, error: e.message }));
  }
}

async function handleVoiceState(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild || oldState.guild;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const k = key(guild.id, member.id);

  // Left voice entirely (or switched channels — close the old session).
  if (oldChannel && (!newChannel || newChannel.id !== oldChannel.id)) {
    await finalizeSession(guild, member, oldChannel.id, 'left');
  }
  if (!newChannel) return;

  // Joined or switched into a channel.
  if (!openSessions.has(k)) {
    openSessions.set(k, { joinedAt: Date.now(), channelId: newChannel.id, qualifyingSince: qualifies(member, newChannel) ? Date.now() : null, minutesAwarded: 0 });
    return;
  }
  // Still in voice: mute/deafen/AFK/alone changes re-start or pause the
  // qualifying clock.
  const session = openSessions.get(k);
  session.channelId = newChannel.id;
  if (qualifies(member, newChannel)) {
    if (!session.qualifyingSince) session.qualifyingSince = Date.now();
  } else if (session.qualifyingSince) {
    // Bank the qualifying minutes so far, then pause.
    const minutes = Math.floor((Date.now() - session.qualifyingSince) / 60_000);
    if (minutes > 0 && db.isEnabled()) {
      await db.query(
        'INSERT INTO voice_sessions (guild_id, user_id, joined_at, left_at, minutes) VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?)',
        [guild.id, member.id, Math.floor(session.joinedAt / 1000), Math.floor(Date.now() / 1000), minutes],
      ).catch(() => {});
      await awardVoiceXp(guild, member, minutes).catch(() => {});
    }
    session.qualifyingSince = null;
  }
}

async function getVoiceStats(guildId, userId) {
  if (!db.isEnabled()) return { totalMinutes: 0, sessions: 0, xp: 0 };
  const rows = await db.query(
    'SELECT COALESCE(SUM(minutes), 0) AS total, COUNT(*) AS sessions FROM voice_sessions WHERE guild_id = ? AND user_id = ?',
    [guildId, userId],
  ) || [];
  const perMinute = config.leveling?.voiceXpPerMinute ?? 2;
  return { totalMinutes: rows[0]?.total || 0, sessions: rows[0]?.sessions || 0, xp: (rows[0]?.total || 0) * perMinute };
}

async function getVoiceLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return await db.query(
    'SELECT user_id, SUM(minutes) AS total_minutes, COUNT(*) AS sessions FROM voice_sessions WHERE guild_id = ? GROUP BY user_id ORDER BY total_minutes DESC LIMIT ?',
    [guildId, limit],
  ) || [];
}

module.exports = { handleVoiceState, getVoiceStats, getVoiceLeaderboard, qualifies };
