// Dashboard-side per-server bot identity (1.16.8): the avatar picture,
// nickname, and command prefix for one server. The dashboard talks to
// Discord's REST API directly with the bot token (the same discordApi +
// botHeaders pattern as the rest of src/dashboard.js) — the bot process is
// not involved, so a change applies immediately. Avatar files + DB rows are
// shared with the bot through src/utils/botIdentity (same table, same
// directory), so the bot's startup reapply picks up dashboard changes.
// The nickname can also be changed with /botidentity; the avatar picture
// and the prefix are dashboard-only.
//
// `rest` is an injectable { get, patch } pair — the dashboard passes its
// axios client wrapped with bot headers; tests pass a fake. Every function
// throws a plain-words Error on failure; the routes turn it into a 400
// with that message. A change that worked live but could not be saved
// returns a `warning` instead of throwing, so the UI can say so plainly.
const {
  getIdentity,
  setNicknameRow,
  setAvatarPathRow,
  clearNicknameRow,
  clearAvatarPathRow,
  validateAvatarBuffer,
  saveAvatarFile,
} = require('./botIdentity');
const { getGuildSettings, setGuildSettings } = require('./guildSettings');

const MAX_PREFIX_LENGTH = 32;

function cdnAvatarUrl(guildId, userId, hash) {
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${hash}.${ext}`;
}

function cdnUserAvatarUrl(userId, hash) {
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}`;
}

function defaultAvatarUrl(userId) {
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// Plain-words version of a Discord REST (axios) failure.
function describeRestError(err) {
  const status = err?.response?.status;
  const message = err?.response?.data?.message || err?.message || '';
  if (status === 429) {
    const retry = err?.response?.data?.retry_after;
    return retry
      ? `Discord is rate-limiting nickname/avatar changes right now — try again in about ${Math.ceil(retry)} seconds.`
      : 'Discord is rate-limiting nickname/avatar changes right now — try again in a few minutes.';
  }
  if (status === 403) return 'I do not have permission to do that in this server — I need the Change Nickname permission.';
  if (status === 400) return message ? `Discord rejected that: ${message}` : 'Discord rejected that value (it may be too long or in the wrong format).';
  if (status === 404) return 'I could not find my own member in this server.';
  return message || 'Discord rejected the change.';
}

function validateNickname(name) {
  const value = String(name ?? '').trim();
  if (!value) return null;
  if (value.length > 32) throw new Error('Nicknames can be at most 32 characters.');
  return value;
}

function validatePrefix(prefix) {
  const value = String(prefix ?? '').trim();
  if (!value) return null;
  if (value.length > MAX_PREFIX_LENGTH) throw new Error(`The command prefix can be at most ${MAX_PREFIX_LENGTH} characters.`);
  return value;
}

function requireRest(rest) {
  if (!rest) throw new Error('Discord is unreachable right now — try again in a bit.');
}

// Current identity for the dashboard tab: the stored row, the live member
// state from Discord (nickname + guild avatar), and the prefix. A failed
// live fetch leaves the live fields null — the stored row and prefix still
// show, and the page never breaks on it.
async function getIdentityView(guildId, { rest } = {}) {
  const row = await getIdentity(guildId);
  const settings = await getGuildSettings(guildId);
  let member = null;
  if (rest) {
    try {
      const res = await rest.get(`/guilds/${guildId}/members/@me`);
      member = res?.data || null;
    } catch {
      member = null;
    }
  }
  const user = member?.user || null;
  const guildAvatarUrl = user && member.avatar ? cdnAvatarUrl(guildId, user.id, member.avatar) : null;
  const globalAvatarUrl = user && user.avatar ? cdnUserAvatarUrl(user.id, user.avatar) : null;
  const avatarUrl = guildAvatarUrl || globalAvatarUrl || (user ? defaultAvatarUrl(user.id) : null);
  return {
    nickname: row?.nickname ?? member?.nick ?? null,
    liveNickname: member?.nick ?? null,
    hasCustomAvatar: !!member?.avatar,
    hasStoredAvatar: !!row?.avatar_path,
    avatarUrl,
    globalAvatarUrl,
    username: user?.username || null,
    prefix: settings.prefix || '',
    updatedAt: row?.updated_at || null,
  };
}

// Save nickname and/or prefix. The nickname is applied live first
// (PATCH members/@me, same as GuildMember.setNickname) and then saved;
// the prefix is DB-only and takes effect when the bot restarts. Only the
// keys present in `patch` are touched. Returns { nickname, prefix, warnings }.
async function setIdentity(guildId, patch, { rest } = {}) {
  const warnings = [];
  let nickname = null;
  let nicknameTouched = false;
  if (patch && 'nickname' in patch) {
    nicknameTouched = true;
    nickname = validateNickname(patch.nickname);
    requireRest(rest);
    try {
      await rest.patch(`/guilds/${guildId}/members/@me`, { nick: nickname });
    } catch (err) {
      throw new Error(describeRestError(err));
    }
    const row = await getIdentity(guildId);
    if (nickname != null) {
      const saveError = await setNicknameRow(guildId, nickname);
      if (saveError) warnings.push(`The nickname was changed live but could not be saved (${saveError.message || 'database error'}) — it may revert when the bot restarts.`);
    } else if (row) {
      await clearNicknameRow(guildId);
    }
  }
  let prefix = null;
  if (patch && 'prefix' in patch) {
    prefix = validatePrefix(patch.prefix);
    await setGuildSettings(guildId, { prefix: prefix || '' });
  }
  const out = { warnings };
  if (nicknameTouched) out.nickname = nickname;
  if (patch && 'prefix' in patch) out.prefix = prefix || '';
  return out;
}

// Upload a new per-server avatar picture: validate, apply live (PATCH
// members/@me with a data URI, same as GuildMember.setAvatar), then save
// the file + DB row so a restart reapplies it. Returns { avatarUrl, warning }.
async function uploadAvatar(guildId, buffer, { rest } = {}) {
  const ext = validateAvatarBuffer(buffer);
  requireRest(rest);
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
  let member = null;
  try {
    const res = await rest.patch(`/guilds/${guildId}/members/@me`, { avatar: dataUri });
    member = res?.data || null;
  } catch (err) {
    throw new Error(describeRestError(err));
  }
  let warning = null;
  try {
    const storedPath = saveAvatarFile(guildId, buffer, ext);
    const saveError = await setAvatarPathRow(guildId, storedPath);
    if (saveError) warning = `The picture was changed live but could not be saved (${saveError.message || 'database error'}) — it may revert when the bot restarts.`;
  } catch (err) {
    warning = `The picture was changed live but could not be saved (${err.message}) — it may revert when the bot restarts.`;
  }
  const avatarUrl = member?.avatar && member?.user?.id
    ? cdnAvatarUrl(guildId, member.user.id, member.avatar)
    : null;
  return { avatarUrl, warning };
}

// Reset the per-server avatar picture back to the bot's global avatar.
// The nickname is untouched. Returns { avatarUrl } (the global picture).
async function resetAvatar(guildId, { rest } = {}) {
  requireRest(rest);
  let member = null;
  try {
    const res = await rest.patch(`/guilds/${guildId}/members/@me`, { avatar: null });
    member = res?.data || null;
  } catch (err) {
    throw new Error(describeRestError(err));
  }
  await clearAvatarPathRow(guildId);
  const avatarUrl = member?.user?.id && member?.user?.avatar
    ? cdnUserAvatarUrl(member.user.id, member.user.avatar)
    : (member?.user?.id ? defaultAvatarUrl(member.user.id) : null);
  return { avatarUrl };
}

module.exports = {
  MAX_PREFIX_LENGTH,
  cdnAvatarUrl,
  cdnUserAvatarUrl,
  defaultAvatarUrl,
  describeRestError,
  validateNickname,
  validatePrefix,
  getIdentityView,
  setIdentity,
  uploadAvatar,
  resetAvatar,
};
