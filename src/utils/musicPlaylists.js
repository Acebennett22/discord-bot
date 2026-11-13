// Saved music playlists — per-user, per-server named queues.
// Tracks are plain { title, url, durationSec } objects, stored as JSON.
const db = require('./database');

const MAX_PLAYLISTS_PER_USER = 10;
const MAX_TRACKS_PER_PLAYLIST = 50;
const MAX_NAME_LENGTH = 50;

async function listPlaylists(guildId, userId) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    'SELECT * FROM music_playlists WHERE guild_id = ? AND user_id = ? ORDER BY updated_at DESC',
    [guildId, userId],
  )) || [];
}

async function getPlaylist(guildId, userId, name) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT * FROM music_playlists WHERE guild_id = ? AND user_id = ? AND name = ?',
    [guildId, userId, name],
  );
  return rows?.[0] || null;
}

function parseTracks(row) {
  try { const t = JSON.parse(row.tracks || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

async function savePlaylist(guildId, userId, name, tracks) {
  if (!db.isEnabled()) return { ok: false, error: 'Database unavailable — playlists need MySQL.' };
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, error: `Playlist name must be 1–${MAX_NAME_LENGTH} characters.` };
  if (!tracks.length) return { ok: false, error: 'There is nothing playing or queued to save right now.' };
  const existing = await listPlaylists(guildId, userId);
  const isUpdate = existing.some((p) => p.name === name);
  if (!isUpdate && existing.length >= MAX_PLAYLISTS_PER_USER) {
    return { ok: false, error: `You already have ${MAX_PLAYLISTS_PER_USER} playlists in this server — delete one first.` };
  }
  const trimmed = tracks.slice(0, MAX_TRACKS_PER_PLAYLIST).map((t) => ({
    title: t.title, url: t.url, durationSec: t.durationSec ?? null,
  }));
  await db.query(
    `INSERT INTO music_playlists (guild_id, user_id, name, tracks) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tracks = VALUES(tracks), updated_at = CURRENT_TIMESTAMP`,
    [guildId, userId, name, JSON.stringify(trimmed)],
  );
  return { ok: true, count: trimmed.length, updated: isUpdate };
}

async function deletePlaylist(guildId, userId, name) {
  if (!db.isEnabled()) return false;
  const res = await db.query('DELETE FROM music_playlists WHERE guild_id = ? AND user_id = ? AND name = ?', [guildId, userId, name]);
  return (res?.affectedRows ?? 0) > 0;
}

async function renamePlaylist(guildId, userId, oldName, newName) {
  if (!db.isEnabled()) return { ok: false, error: 'Database unavailable — playlists need MySQL.' };
  if (!newName || newName.length > MAX_NAME_LENGTH) return { ok: false, error: `Playlist name must be 1–${MAX_NAME_LENGTH} characters.` };
  if (await getPlaylist(guildId, userId, newName)) return { ok: false, error: `You already have a playlist called **${newName}**.` };
  const res = await db.query(
    'UPDATE music_playlists SET name = ? WHERE guild_id = ? AND user_id = ? AND name = ?',
    [newName, guildId, userId, oldName],
  );
  if ((res?.affectedRows ?? 0) === 0) return { ok: false, error: `No playlist called **${oldName}** found.` };
  return { ok: true };
}

async function listAllPlaylists(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM music_playlists WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 100', [guildId])) || [];
}

module.exports = {
  MAX_PLAYLISTS_PER_USER, MAX_TRACKS_PER_PLAYLIST, MAX_NAME_LENGTH,
  listPlaylists, getPlaylist, parseTracks, savePlaylist, deletePlaylist, renamePlaylist, listAllPlaylists,
};
