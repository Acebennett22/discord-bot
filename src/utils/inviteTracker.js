// Invite tracking: cache each guild's invites (code -> uses, inviter) on
// startup and on InviteCreate/InviteDelete. On GuildMemberAdd, compare the
// cached uses to the live list — the invite whose uses went up is the
// inviter. Requires the bot to have Manage Server (MANAGE_GUILD) to fetch
// invites; without it, tracking degrades to "unknown inviter".
// Vanity URL joins are counted separately (inviter = vanity, no user).
// Joins from accounts younger than the threshold are flagged fake and do
// not count toward valid invites.
const db = require('./database');
const config = require('./config');
const { getGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');

// guildId -> Map(code -> { uses, inviterId, channelId, maxUses })
const inviteCache = new Map();
// guildId -> vanity uses count
const vanityCache = new Map();

function minAccountAgeDays(guildId, settings) {
  if (settings?.inviteMinAccountAgeDays != null) return settings.inviteMinAccountAgeDays;
  return config.invites?.minAccountAgeDays ?? 7;
}

async function refreshGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    for (const inv of invites.values()) {
      map.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter?.id || null, channelId: inv.channelId, maxUses: inv.maxUses });
    }
    inviteCache.set(guild.id, map);
    if (db.isEnabled()) {
      for (const [code, data] of map) {
        await db.query(
          `INSERT INTO invites (guild_id, code, inviter_id, channel_id, uses, max_uses) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE inviter_id = VALUES(inviter_id), channel_id = VALUES(channel_id), uses = VALUES(uses), max_uses = VALUES(max_uses)`,
          [guild.id, code, data.inviterId, data.channelId, data.uses, data.maxUses || null],
        ).catch(() => {});
      }
    }
    // Vanity URL uses
    try {
      const vanity = await guild.fetchVanityData().catch(() => null);
      if (vanity) vanityCache.set(guild.id, vanity.uses ?? 0);
    } catch {}
    return map;
  } catch (err) {
    console.warn(`[invites] Could not fetch invites for ${guild.id} (needs Manage Server permission):`, err.message);
    return inviteCache.get(guild.id) || new Map();
  }
}

async function initInviteTracker(client) {
  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild);
  }
  console.log('[invites] Invite caches primed.');
}

async function recomputeUserInvites(guildId, userId) {
  if (!db.isEnabled() || !userId) return;
  const rows = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN left_at IS NULL AND is_fake = 0 THEN 1 ELSE 0 END) AS valid,
            SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END) AS leaves,
            SUM(CASE WHEN is_fake = 1 THEN 1 ELSE 0 END) AS fake
     FROM invite_uses WHERE guild_id = ? AND inviter_id = ?`,
    [guildId, userId]) || [];
  const r = rows[0] || {};
  await db.query(
    `INSERT INTO user_invites (user_id, guild_id, total_invites, valid_invites, leaves, fake_invites)
     VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_invites = VALUES(total_invites), valid_invites = VALUES(valid_invites), leaves = VALUES(leaves), fake_invites = VALUES(fake_invites)`,
    [userId, guildId, r.total || 0, r.valid || 0, r.leaves || 0, r.fake || 0]);
}

async function getUserInviteStats(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM user_invites WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  if (rows?.length) return rows[0];
  // No cached row yet — compute live from invite_uses.
  const live = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN left_at IS NULL AND is_fake = 0 THEN 1 ELSE 0 END) AS valid,
            SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END) AS leaves,
            SUM(CASE WHEN is_fake = 1 THEN 1 ELSE 0 END) AS fake
     FROM invite_uses WHERE guild_id = ? AND inviter_id = ?`,
    [guildId, userId]) || [];
  const r = live[0] || {};
  return { user_id: userId, guild_id: guildId, total_invites: r.total || 0, valid_invites: r.valid || 0, leaves: r.leaves || 0, fake_invites: r.fake || 0 };
}

async function recordJoin(member) {
  const guild = member.guild;
  const settings = await getGuildSettings(guild.id);
  const threshold = minAccountAgeDays(guild.id, settings);
  const accountAgeDays = (Date.now() - member.user.createdAt.getTime()) / 86_400_000;
  const isFake = accountAgeDays < threshold;

  let inviterId = null;
  let inviteCode = null;
  let vanity = false;
  const before = inviteCache.get(guild.id) || new Map();
  const live = await refreshGuildInvites(guild);
  for (const [code, data] of live) {
    const prev = before.get(code);
    if (prev && data.uses > prev.uses) { inviterId = data.inviterId; inviteCode = code; break; }
    if (!prev && data.uses > 0) { inviterId = data.inviterId; inviteCode = code; break; }
  }
  if (!inviteCode) {
    // Vanity URL check
    try {
      const vanityData = await guild.fetchVanityData().catch(() => null);
      if (vanityData && (vanityCache.get(guild.id) ?? 0) < (vanityData.uses ?? 0)) {
        vanity = true; inviteCode = 'vanity'; inviterId = null;
        vanityCache.set(guild.id, vanityData.uses ?? 0);
      }
    } catch {}
  }

  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO invite_uses (guild_id, invite_code, inviter_id, invitee_id, is_fake) VALUES (?, ?, ?, ?, ?)',
      [guild.id, inviteCode || 'unknown', inviterId, member.id, isFake ? 1 : 0]);
    if (inviterId) {
      await recomputeUserInvites(guild.id, inviterId);
      // Invite rewards (1.8.4): grant milestone rewards when the inviter's
      // valid invite count reaches a configured milestone. Fake joins
      // (isFake) never count — recomputeUserInvites only counts valid ones.
      if (!isFake) {
        const { checkInviteRewards } = require('./inviteRewards');
        const stats = await getUserInviteStats(guild.id, inviterId);
        await checkInviteRewards(guild, inviterId, stats?.valid_invites || 0).catch(() => {});
      }
    }
  }

  // Invite-based auto-role (1.11.6): joining via a specific invite code
  // grants the role configured for that code. Never fatal to the join flow.
  const { grantInviteRole } = require('./inviteRoles');
  await grantInviteRole(member, inviteCode).catch(() => {});

  // Invite log message (inviteLogChannelId, else welcome channel).
  const logChannelId = settings.inviteLogChannelId || settings.welcomeChannelId;
  if (logChannelId) {
    const channel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const stats = inviterId ? await getUserInviteStats(guild.id, inviterId) : null;
      const who = vanity ? 'the vanity URL' : inviterId ? `<@${inviterId}>` : 'an unknown invite';
      await channel.send({ embeds: [infoEmbed('📨 New member',
        `${member} joined via ${who}${inviteCode && inviteCode !== 'vanity' && inviteCode !== 'unknown' ? ` (\`discord.gg/${inviteCode}\`)` : ''}.${stats ? `\n<@${inviterId}> now has **${stats.valid_invites}** valid invite(s).` : ''}${isFake ? `\n⚠️ Account is under ${threshold} days old — flagged as a possible fake invite.` : ''}`)] }).catch(() => {});
    }
  }
  return { inviterId, inviteCode, vanity, isFake };
}

async function recordLeave(member) {
  if (!db.isEnabled()) return;
  const rows = await db.query(
    'SELECT * FROM invite_uses WHERE guild_id = ? AND invitee_id = ? AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1',
    [member.guild.id, member.id]) || [];
  const use = rows[0];
  if (!use) return;
  await db.query('UPDATE invite_uses SET left_at = NOW() WHERE id = ?', [use.id]);
  if (use.inviter_id) await recomputeUserInvites(member.guild.id, use.inviter_id);
}

module.exports = { initInviteTracker, refreshGuildInvites, recordJoin, recordLeave, getUserInviteStats, recomputeUserInvites, inviteCache };
