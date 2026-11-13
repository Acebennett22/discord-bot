// Server backup / restore (1.5.4): snapshots roles, channels, and the bot's
// own per-server settings into a JSON file under backups/
// (server-<guildId>-<timestamp>.json) — file storage, so the DB doesn't
// bloat; server_backups only holds metadata. Message history is NOT backed
// up (Discord doesn't allow reading full history for this). Restore is
// non-destructive by default: roles/channels that don't exist are created,
// ones that do exist are updated by name, and nothing is ever deleted
// unless the --replace flag is passed.
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

function backupFilePath(guildId, name) {
  const safe = String(name || 'backup').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 64);
  return path.join(BACKUP_DIR, `server-${guildId}-${Date.now()}-${safe}.json`);
}

async function snapshotData(guildId, guildName, createdBy, name, roles, channels, settings) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const data = {
    version: 1, guildId, guildName, createdAt: new Date().toISOString(),
    createdBy: createdBy?.id || createdBy || null, name: name || 'backup',
    roles, channels, settings: settings || {},
  };
  const filePath = backupFilePath(guildId, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  const size = fs.statSync(filePath).size;
  let id = null;
  if (db.isEnabled()) {
    const res = await db.query(
      'INSERT INTO server_backups (guild_id, created_by, name, file_path, size_bytes) VALUES (?, ?, ?, ?, ?)',
      [guildId, createdBy?.id || createdBy || null, name || 'backup', filePath, size],
    );
    id = res.insertId;
  }
  return { id, filePath, size, roles: roles.length, channels: channels.length };
}

async function createBackup(guild, createdBy, name) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id) // skip @everyone
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position }));
  const channels = [...guild.channels.cache.values()]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((c) => ({
      name: c.name, type: c.type, topic: c.topic || null, position: c.position,
      parent: c.parent?.name || null,
      permissionOverwrites: [...(c.permissionOverwrites?.cache?.values() || [])].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    }));
  const settings = await getGuildSettings(guild.id).catch(() => ({}));
  return snapshotData(guild.id, guild.name, createdBy, name, roles, channels, settings);
}

// Restore via the Discord REST API (for the dashboard, which has no live
// discord.js client). `api` is { get, post, patch, del } bound to discordApi
// with bot headers. Roles are matched by name; permission overwrites are
// translated from stored names/IDs where possible (overwrites referencing
// roles use the restored role IDs; user overwrites are kept by ID).
async function restoreBackupViaApi(guildId, backup, { replace = false, api }) {
  const data = JSON.parse(fs.readFileSync(backup.file_path, 'utf8'));
  const summary = { rolesCreated: 0, rolesUpdated: 0, channelsCreated: 0, channelsUpdated: 0, rolesDeleted: 0, channelsDeleted: 0 };
  const rolesRes = await api.get(`/guilds/${guildId}/roles`);
  const liveRoles = rolesRes.data || [];
  const roleByName = new Map(liveRoles.map((r) => [r.name, r]));
  const roleIdByName = new Map(liveRoles.map((r) => [r.name, r.id]));
  for (const r of data.roles || []) {
    const existing = roleByName.get(r.name);
    if (existing) {
      await api.patch(`/guilds/${guildId}/roles/${existing.id}`, { color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions }).catch(() => {});
      summary.rolesUpdated += 1;
    } else {
      const created = await api.post(`/guilds/${guildId}/roles`, { name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions }).catch(() => null);
      if (created?.data?.id) { summary.rolesCreated += 1; roleIdByName.set(r.name, created.data.id); roleByName.set(r.name, created.data); }
    }
  }
  const channelsRes = await api.get(`/guilds/${guildId}/channels`);
  const liveChannels = channelsRes.data || [];
  const channelByName = new Map(liveChannels.map((c) => [c.name, c]));
  const categoryByName = new Map(liveChannels.filter((c) => c.type === 4).map((c) => [c.name, c]));
  const translateOverwrites = (list) => (list || []).map((o) => {
    let id = o.id;
    if (o.type === 0) { // role overwrite — map by stored role name if possible
      const match = (data.roles || []).find((r) => r.name && String(r.id || '') === String(o.id));
      if (match && roleIdByName.has(match.name)) id = roleIdByName.get(match.name);
    }
    return { id, type: o.type, allow: o.allow, deny: o.deny };
  });
  for (const c of data.channels || []) {
    if (c.type === 4) {
      if (!channelByName.has(c.name)) {
        const created = await api.post(`/guilds/${guildId}/channels`, { name: c.name, type: 4 }).catch(() => null);
        if (created?.data?.id) { summary.channelsCreated += 1; channelByName.set(c.name, created.data); categoryByName.set(c.name, created.data); }
      }
      continue;
    }
    const parent = c.parent ? categoryByName.get(c.parent) : null;
    const existing = channelByName.get(c.name);
    if (existing) {
      await api.patch(`/channels/${existing.id}`, { topic: c.topic || undefined, parent_id: parent?.id || undefined }).catch(() => {});
      summary.channelsUpdated += 1;
    } else {
      const created = await api.post(`/guilds/${guildId}/channels`, {
        name: c.name, type: c.type, topic: c.topic || undefined,
        parent_id: parent?.id || undefined,
        permission_overwrites: translateOverwrites(c.permissionOverwrites),
      }).catch(() => null);
      if (created?.data?.id) { summary.channelsCreated += 1; channelByName.set(c.name, created.data); }
    }
  }
  if (replace) {
    const backupRoleNames = new Set((data.roles || []).map((r) => r.name));
    const backupChannelNames = new Set((data.channels || []).map((c) => c.name));
    for (const r of liveRoles) {
      if (r.managed || backupRoleNames.has(r.name)) continue;
      await api.del(`/guilds/${guildId}/roles/${r.id}`).catch(() => {});
      summary.rolesDeleted += 1;
    }
    for (const c of liveChannels) {
      if (backupChannelNames.has(c.name)) continue;
      await api.del(`/channels/${c.id}`).catch(() => {});
      summary.channelsDeleted += 1;
    }
  }
  return summary;
}

async function listBackups(guildId) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT * FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20', [guildId]) || [];
}

// Restore: creates missing roles/channels, updates existing ones by name.
// Returns a summary. Never deletes anything unless replace=true.
async function restoreBackup(guild, backup, { replace = false } = {}) {
  const data = JSON.parse(fs.readFileSync(backup.file_path, 'utf8'));
  const summary = { rolesCreated: 0, rolesUpdated: 0, channelsCreated: 0, channelsUpdated: 0, rolesDeleted: 0, channelsDeleted: 0 };
  const roleByName = new Map([...guild.roles.cache.values()].map((r) => [r.name, r]));
  const createdRoles = new Map();
  for (const r of data.roles || []) {
    const existing = roleByName.get(r.name);
    if (existing) {
      await existing.edit({ color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions) }).catch(() => {});
      summary.rolesUpdated += 1;
      createdRoles.set(r.name, existing);
    } else {
      const created = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions) }).catch(() => null);
      if (created) { summary.rolesCreated += 1; createdRoles.set(r.name, created); }
    }
  }
  const channelByName = new Map([...guild.channels.cache.values()].map((c) => [c.name, c]));
  const categoryByName = new Map([...guild.channels.cache.values()].filter((c) => c.type === 4).map((c) => [c.name, c]));
  for (const c of data.channels || []) {
    if (c.type === 4) { // categories first pass handled inline below
      if (!channelByName.has(c.name)) {
        const created = await guild.channels.create({ name: c.name, type: 4 }).catch(() => null);
        if (created) { summary.channelsCreated += 1; channelByName.set(c.name, created); categoryByName.set(c.name, created); }
      }
      continue;
    }
    const parent = c.parent ? categoryByName.get(c.parent) : null;
    const existing = channelByName.get(c.name);
    if (existing) {
      await existing.edit({ topic: c.topic || undefined, parent: parent || undefined }).catch(() => {});
      summary.channelsUpdated += 1;
    } else {
      const created = await guild.channels.create({ name: c.name, type: c.type, topic: c.topic || undefined, parent: parent || undefined }).catch(() => null);
      if (created) { summary.channelsCreated += 1; channelByName.set(c.name, created); }
    }
  }
  if (replace) {
    // Delete roles/channels that exist now but weren't in the backup.
    for (const r of [...guild.roles.cache.values()]) {
      if (r.id === guild.id || r.managed || r.position >= guild.members.me.roles.highest.position) continue;
      if (!(data.roles || []).some((x) => x.name === r.name)) {
        await r.delete('Server backup restore (--replace)').catch(() => {});
        summary.rolesDeleted += 1;
      }
    }
    for (const c of [...guild.channels.cache.values()]) {
      if (!(data.channels || []).some((x) => x.name === c.name)) {
        await c.delete('Server backup restore (--replace)').catch(() => {});
        summary.channelsDeleted += 1;
      }
    }
  }
  return summary;
}

module.exports = { createBackup, snapshotData, listBackups, restoreBackup, restoreBackupViaApi, BACKUP_DIR };
