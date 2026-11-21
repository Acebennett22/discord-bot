// Per-server bot identity (1.16.8): each guild can give the bot its own
// nickname and avatar picture, different per server. The bot's global
// username/avatar are untouched — this is per-guild only, via the bot's
// own GuildMember (setNickname / setAvatar). The nickname is set with
// /botidentity (Discord) or on the dashboard; the avatar picture is
// dashboard-only (src/utils/dashboardIdentity.js) — there is no avatar
// subcommand. Stored in the guild_bot_identity table; avatar files live
// under src/data/guild-avatars (gitignored) and are reapplied on startup.
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');

const AVATAR_DIR = path.join(__dirname, '..', 'data', 'guild-avatars');
const MAX_AVATAR_BYTES = 8 * 1024 * 1024; // 8 MB

// Magic bytes: PNG 89 50 4E 47 0D 0A 1A 0A, JPEG FF D8 FF, GIF "GIF8".
// Content-Type headers can lie; the bytes cannot.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'gif';
  return null;
}

// Plain-words version of a Discord API failure, for user-facing replies.
function describeDiscordError(err) {
  const code = err?.code;
  const status = err?.status;
  const message = err?.message || '';
  if (status === 429 || /429|rate ?limit/i.test(message)) {
    return 'Discord is rate-limiting nickname/avatar changes right now — try again in a few minutes.';
  }
  if (code === 50013 || status === 403) {
    return 'I do not have permission to do that in this server — I need the Change Nickname permission.';
  }
  if (code === 50001) return 'I do not have access to do that in this server.';
  if (code === 50035) return 'Discord rejected that value (it may be too long or in the wrong format).';
  return message || 'Discord rejected the change.';
}

// --- Avatar files -----------------------------------------------------------

function avatarFilePath(guildId, ext) {
  return path.join(AVATAR_DIR, `${guildId}.${ext}`);
}

// Stored paths are repo-relative (src/data/guild-avatars/<id>.<ext>) so the
// row stays valid if the install moves. Absolute paths still resolve.
function resolveAvatarPath(storedPath) {
  if (!storedPath) return null;
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.join(__dirname, '..', '..', storedPath);
}

function storedAvatarPath(guildId, ext) {
  return path.join('src', 'data', 'guild-avatars', `${guildId}.${ext}`);
}

function deleteAvatarFiles(guildId) {
  for (const ext of ['png', 'jpg', 'gif']) {
    try { fs.unlinkSync(avatarFilePath(guildId, ext)); } catch { /* already gone */ }
  }
}

// Validate an uploaded avatar buffer: real PNG/JPG/GIF under 8 MB.
// Throws with a plain-words message on any failure. The dashboard upload
// hands over raw bytes; the magic bytes are the check (a Content-Type
// header can lie, the bytes cannot).
function validateAvatarBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('That file is not an image.');
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(`That image is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`);
  }
  const ext = detectImageType(buffer);
  if (!ext) throw new Error('That file is not a PNG, JPG, or GIF image.');
  return ext;
}

// Write an avatar file (replacing any previous extension for this guild)
// and return its repo-relative stored path.
function saveAvatarFile(guildId, buffer, ext) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  deleteAvatarFiles(guildId);
  fs.writeFileSync(avatarFilePath(guildId, ext), buffer);
  return storedAvatarPath(guildId, ext);
}

// --- Database ---------------------------------------------------------------

async function getIdentity(guildId) {
  const rows = await db.query(
    'SELECT guild_id, nickname, avatar_path, updated_at FROM guild_bot_identity WHERE guild_id = ?',
    [guildId],
  );
  return rows?.[0] || null;
}

// queryDetailed (not query) so a failed write is visible to the caller —
// a silent null here would mean "saved" when it was not (1.15.39 pattern).
async function setNicknameRow(guildId, nickname) {
  const { error } = await db.queryDetailed(
    'INSERT INTO guild_bot_identity (guild_id, nickname) VALUES (?, ?) ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), updated_at = CURRENT_TIMESTAMP',
    [guildId, nickname],
  );
  return error || null;
}

async function setAvatarPathRow(guildId, avatarPath) {
  const { error } = await db.queryDetailed(
    'INSERT INTO guild_bot_identity (guild_id, avatar_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar_path = VALUES(avatar_path), updated_at = CURRENT_TIMESTAMP',
    [guildId, avatarPath],
  );
  return error || null;
}

async function deleteIdentityRow(guildId) {
  await db.query('DELETE FROM guild_bot_identity WHERE guild_id = ?', [guildId]);
}

// Clear one half of a stored identity, deleting the whole row when the
// other half is empty too — so a reset never leaves a pointless empty row.
async function clearNicknameRow(guildId) {
  const row = await getIdentity(guildId);
  if (!row) return;
  if (!row.avatar_path) await deleteIdentityRow(guildId);
  else await setNicknameRow(guildId, null);
}

async function clearAvatarPathRow(guildId) {
  const row = await getIdentity(guildId);
  if (!row) return;
  if (row.avatar_path) deleteAvatarFiles(guildId);
  if (row.nickname == null) await deleteIdentityRow(guildId);
  else await setAvatarPathRow(guildId, null);
}

// --- Live apply -------------------------------------------------------------

async function fetchOwnMember(guild) {
  return guild.members.me ?? await guild.members.fetchMe().catch(() => null);
}

// Apply one guild's stored identity to its live member. Never throws —
// a failure (missing permission, missing file, rate limit) is logged and
// reported in the return value so startup never dies on one guild.
async function applyIdentity(guild) {
  try {
    const row = await getIdentity(guild.id);
    if (!row || (row.nickname == null && !row.avatar_path)) {
      return { applied: false, reason: 'no identity stored' };
    }
    const me = await fetchOwnMember(guild);
    if (!me) {
      console.warn(`[botidentity] ${guild.id}: could not fetch own member, skipping reapply.`);
      return { applied: false, reason: 'could not fetch own member' };
    }
    if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
      console.warn(`[botidentity] ${guild.id}: missing Change Nickname permission, skipping reapply.`);
      return { applied: false, reason: 'missing Change Nickname permission' };
    }
    if (row.nickname != null) {
      try {
        await me.setNickname(row.nickname);
      } catch (err) {
        console.warn(`[botidentity] ${guild.id}: nickname reapply failed:`, describeDiscordError(err));
      }
    }
    if (row.avatar_path) {
      const file = resolveAvatarPath(row.avatar_path);
      try {
        const buffer = fs.readFileSync(file);
        await me.setAvatar(buffer);
      } catch (err) {
        const reason = err?.code === 'ENOENT' ? 'saved avatar file is missing' : describeDiscordError(err);
        console.warn(`[botidentity] ${guild.id}: avatar reapply failed:`, reason);
      }
    }
    return { applied: true };
  } catch (err) {
    console.warn(`[botidentity] ${guild.id}: reapply failed:`, err.message);
    return { applied: false, reason: err.message };
  }
}

// Reapply every stored identity the client can see. Called from ready.js;
// each shard only sees its own guilds, which is exactly the set it owns.
async function reapplyAllIdentities(client) {
  for (const guild of client.guilds.cache.values()) {
    await applyIdentity(guild);
  }
}

// Live nickname reset + stored cleanup. Never touches the avatar — the
// picture is dashboard-only, so /botidentity reset must leave it alone.
// Returns { hadStored, errors }. The stored nickname is only cleared when
// the live member could be fetched — if it could not, the row stays so a
// later restart can retry.
async function resetNickname(guild) {
  const me = await fetchOwnMember(guild);
  const errors = [];
  if (!me) return { hadStored: false, errors: ['I could not find my own member in this server.'] };
  try {
    await me.setNickname(null);
  } catch (err) {
    errors.push(`nickname: ${describeDiscordError(err)}`);
  }
  const row = await getIdentity(guild.id);
  const hadStored = !!(row && row.nickname != null);
  if (row) await clearNicknameRow(guild.id);
  return { hadStored, errors };
}

// Live avatar reset + stored cleanup. Dashboard-only (there is no avatar
// subcommand); the nickname is untouched. Same return shape as resetNickname.
async function resetAvatar(guild) {
  const me = await fetchOwnMember(guild);
  const errors = [];
  if (!me) return { hadStored: false, errors: ['I could not find my own member in this server.'] };
  try {
    await me.setAvatar(null);
  } catch (err) {
    errors.push(`avatar: ${describeDiscordError(err)}`);
  }
  const row = await getIdentity(guild.id);
  const hadStored = !!(row && row.avatar_path);
  if (row) await clearAvatarPathRow(guild.id);
  return { hadStored, errors };
}

module.exports = {
  AVATAR_DIR,
  MAX_AVATAR_BYTES,
  detectImageType,
  describeDiscordError,
  avatarFilePath,
  resolveAvatarPath,
  storedAvatarPath,
  deleteAvatarFiles,
  validateAvatarBuffer,
  saveAvatarFile,
  getIdentity,
  setNicknameRow,
  setAvatarPathRow,
  deleteIdentityRow,
  clearNicknameRow,
  clearAvatarPathRow,
  fetchOwnMember,
  applyIdentity,
  reapplyAllIdentities,
  resetNickname,
  resetAvatar,
};
