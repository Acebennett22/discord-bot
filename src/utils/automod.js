// Automod: spam detection, banned-words filter, link + Discord-invite
// blocking. All settings live in MySQL (automod_settings, one row per
// guild); every action is logged to automod_actions + optionally the
// configured log channel. Exempt roles/channels bypass all checks.
// The pure detectors (detectSpam / containsBannedWord / containsLink /
// containsInvite) are exported for testing without a live Discord login.
const db = require('./database');
const { addWarn } = require('./warns');
const { infoEmbed } = require('./embeds');
const { logWarn } = require('./errorLogger');
const { getGuildSettings } = require('./guildSettings');
const { markBotDeleted } = require('../events/ghostPing');

const DEFAULTS = {
  enabled: false,
  spamMaxMessages: 5,
  spamWindowSeconds: 5,
  spamAction: 'delete_warn', // delete | warn | timeout | delete_warn | delete_timeout
  spamTimeoutMinutes: 10,
  bannedWords: [],
  blockLinks: false,
  blockInvites: true,
  exemptRoles: [],
  exemptChannels: [],
  logChannelId: '',
};

const LINK_RE = /https?:\/\/[^\s]+/i;
const INVITE_RE = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-z0-9]+/i;

// In-memory spam windows: guildId -> userId -> [timestamps ms]. Pruned on
// each check; nothing here is persisted (automod_actions is the record).
const spamWindows = new Map();

// --- Pure detectors -----------------------------------------------------------

function detectSpam(timestamps, maxMessages, windowSeconds) {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const recent = timestamps.filter((t) => t > cutoff);
  return recent.length >= maxMessages;
}

function containsBannedWord(content, words) {
  const lower = String(content || '').toLowerCase();
  for (const w of words || []) {
    const word = String(w || '').trim().toLowerCase();
    if (!word) continue;
    // Word-boundary match so "class" doesn't trip on "ass".
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) return word;
  }
  return null;
}

function containsLink(content) { return LINK_RE.test(String(content || '')); }
function containsInvite(content) { return INVITE_RE.test(String(content || '')); }

// --- Settings -----------------------------------------------------------------

async function getSettings(guildId) {
  if (!db.isEnabled()) return { ...DEFAULTS };
  const rows = await db.query('SELECT * FROM automod_settings WHERE guild_id = ?', [guildId]);
  const r = rows?.[0];
  if (!r) return { ...DEFAULTS };
  const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  return {
    enabled: Boolean(r.enabled),
    spamMaxMessages: r.spam_max_messages,
    spamWindowSeconds: r.spam_window_seconds,
    spamAction: r.spam_action,
    spamTimeoutMinutes: r.spam_timeout_minutes,
    bannedWords: parseList(r.banned_words),
    blockLinks: Boolean(r.block_links),
    blockInvites: Boolean(r.block_invites),
    exemptRoles: parseList(r.exempt_roles),
    exemptChannels: parseList(r.exempt_channels),
    logChannelId: r.log_channel_id || '',
  };
}

async function setSettings(guildId, patch) {
  const current = await getSettings(guildId);
  const next = { ...current, ...patch };
  if (!db.isEnabled()) return { saved: false, settings: next };
  await db.query(
    `INSERT INTO automod_settings (guild_id, enabled, spam_max_messages, spam_window_seconds, spam_action, spam_timeout_minutes, banned_words, block_links, block_invites, exempt_roles, exempt_channels, log_channel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), spam_max_messages = VALUES(spam_max_messages),
       spam_window_seconds = VALUES(spam_window_seconds), spam_action = VALUES(spam_action),
       spam_timeout_minutes = VALUES(spam_timeout_minutes), banned_words = VALUES(banned_words),
       block_links = VALUES(block_links), block_invites = VALUES(block_invites),
       exempt_roles = VALUES(exempt_roles), exempt_channels = VALUES(exempt_channels),
       log_channel_id = VALUES(log_channel_id)`,
    [guildId, next.enabled ? 1 : 0, next.spamMaxMessages, next.spamWindowSeconds, next.spamAction,
     next.spamTimeoutMinutes, JSON.stringify(next.bannedWords || []), next.blockLinks ? 1 : 0,
     next.blockInvites ? 1 : 0, JSON.stringify(next.exemptRoles || []),
     JSON.stringify(next.exemptChannels || []), next.logChannelId || null],
  );
  return { saved: true, settings: next };
}

function isExempt(message, settings) {
  if (!message.member) return false;
  if (settings.exemptChannels.includes(message.channelId)) return true;
  return message.member.roles.cache.some((r) => settings.exemptRoles.includes(r.id));
}

// --- Actions ------------------------------------------------------------------

async function logAction(guild, userId, action, reason, message, channelId) {
  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO automod_actions (guild_id, user_id, action, reason, message_excerpt, channel_id) VALUES (?, ?, ?, ?, ?, ?)',
      [guild.id, userId, action, reason, message ? message.content.slice(0, 500) : null, channelId || null],
    );
  }
  const settings = await getSettings(guild.id);
  const logChannelId = settings.logChannelId;
  if (!logChannelId) return;
  const channel = guild.channels.cache.get(logChannelId)
    || await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [infoEmbed(`🛡️ Automod — ${action}`,
      `**User:** <@${userId}>\n**Reason:** ${reason}\n**Channel:** <#${channelId}>\n**Message:** ${message ? message.content.slice(0, 500) || '(no text)' : '(deleted)'}`)],
  }).catch(() => {});
}

async function applyAction(message, settings, reason) {
  const action = settings.spamAction;
  const shouldDelete = action.startsWith('delete');
  const shouldWarn = action === 'warn' || action === 'delete_warn';
  const shouldTimeout = action === 'timeout' || action === 'delete_timeout';
  let deleted = false;
  if (shouldDelete) {
    try { markBotDeleted(message.id); await message.delete(); deleted = true; } catch {}
  }
  if (shouldWarn) {
    addWarn(message.guild.id, message.author.id, { reason: `Automod: ${reason}`, moderator: message.client.user.id });
  }
  if (shouldTimeout) {
    try {
      await message.member.timeout(settings.spamTimeoutMinutes * 60_000, `Automod: ${reason}`);
    } catch (err) {
      await logWarn('automod: timeout failed', { guildId: message.guild.id, userId: message.author.id, error: err.message });
    }
  }
  await logAction(message.guild, message.author.id, action, reason, message, message.channelId);
  return { deleted, action };
}

// --- Message handler (called from messageCreate) ------------------------------
// Returns { deleted: true, reason } when a message was actioned, else null.
// A message that trips several rules is only actioned once (first match wins:
// spam > banned word > invite > link).

async function handleMessage(message) {
  if (message.author.bot || !message.guild || !message.member) return null;
  // Admins are never automodded.
  if (message.member.permissions?.has('Administrator')) return null;
  // New-member link block (1.12.5): members who joined less than N days ago
  // cannot post links. Runs independently of the main Automod toggle, and
  // uses the Automod exempt roles/channels. The warning deletes itself.
  const guildSettings = await getGuildSettings(message.guild.id).catch(() => null);
  if (guildSettings?.newMemberLinkEnabled) {
    const joinedAt = message.member.joinedTimestamp;
    const days = joinedAt ? Math.floor((Date.now() - joinedAt) / 86_400_000) : 0;
    const isExemptHere = await getSettings(message.guild.id).then((s) => isExempt(message, s)).catch(() => false);
    if (days < (guildSettings.newMemberLinkDays ?? 7) && !isExemptHere && (containsLink(message.content) || containsInvite(message.content))) {
      try { await message.delete(); } catch {}
      const warn = await message.channel.send(`⚠️ <@${message.author.id}>, new members can't post links until they've been here ${guildSettings.newMemberLinkDays ?? 7} days.`).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 10_000);
      await logAction(message.guild, message.author.id, 'delete', `new-member link block (${days}d in server)`, message, message.channelId).catch(() => {});
      return { deleted: true, reason: 'new-member link block' };
    }
  }
  const settings = await getSettings(message.guild.id);
  if (!settings.enabled) return null;
  if (isExempt(message, settings)) return null;

  // 1. Spam: X messages in Y seconds (per user, per guild).
  const now = Date.now();
  const guildMap = spamWindows.get(message.guild.id) || new Map();
  const stamps = [...(guildMap.get(message.author.id) || []), now]
    .filter((t) => t > now - settings.spamWindowSeconds * 1000);
  guildMap.set(message.author.id, stamps);
  spamWindows.set(message.guild.id, guildMap);
  if (detectSpam(stamps, settings.spamMaxMessages, settings.spamWindowSeconds)) {
    guildMap.set(message.author.id, []); // reset so one burst = one action
    return applyAction(message, settings, `spam: ${settings.spamMaxMessages}+ messages in ${settings.spamWindowSeconds}s`);
  }

  // 2. Banned words.
  const badWord = containsBannedWord(message.content, settings.bannedWords);
  if (badWord) {
    return applyAction(message, settings, `banned word: "${badWord}"`);
  }

  // 3. Discord invites (checked before generic links so the reason is exact).
  if (settings.blockInvites && containsInvite(message.content)) {
    return applyAction(message, settings, 'Discord invite link');
  }

  // 4. Links.
  if (settings.blockLinks && containsLink(message.content)) {
    return applyAction(message, settings, 'link');
  }

  return null;
}

module.exports = {
  DEFAULTS, getSettings, setSettings, isExempt,
  detectSpam, containsBannedWord, containsLink, containsInvite,
  handleMessage, logAction,
};
