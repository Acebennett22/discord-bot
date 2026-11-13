// Pluggable game-server status system.
// A provider is { id, name, query(host, port, extra) -> { online, players, maxPlayers, map, version, motd } }.
// Adding a new provider = one entry in `providers` below (one function).
// Adding a new GAME needs no code: pick an existing provider via
// config.json `gameServers.custom` or the /gameserver-add command (DB).
// Shipped providers: minecraft (Java server-list ping), source (A2S query —
// covers Rust, CS2, TF2, Garry's Mod, ARK, Valheim…), http (generic JSON
// endpoint), manual (no query protocol — status is set by hand; The Isle
// Evrima has no public query protocol, so it is manual-only — see README).
const net = require('net');
const dgram = require('dgram');
const db = require('./database');
const config = require('./config');
const { infoEmbed, errorEmbed } = require('./embeds');

function getPath(obj, path) {
  return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// --- Minecraft Java server-list ping -------------------------------------------
function writeVarInt(value) {
  const out = [];
  do { let b = value & 0x7f; value >>>= 7; if (value) b |= 0x80; out.push(b); } while (value);
  return Buffer.from(out);
}
function readVarInt(buf, offset) {
  let value = 0; let shift = 0; let i = offset;
  while (true) {
    const b = buf[i++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 35) throw new Error('VarInt too long');
  }
  return { value, offset: i };
}
function mcPacket(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
async function queryMinecraft(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const handshake = mcPacket(0x00, Buffer.concat([
        writeVarInt(47), writeVarInt(hostBuf.length), hostBuf,
        Buffer.from([port >> 8, port & 0xff]), writeVarInt(1),
      ]));
      socket.write(handshake);
      socket.write(mcPacket(0x00, Buffer.alloc(0)));
    });
    let data = Buffer.alloc(0);
    const done = (result) => { try { socket.destroy(); } catch {} resolve(result); };
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      try {
        const { offset: o1 } = readVarInt(data, 0);
        const { value: packetId, offset: o2 } = readVarInt(data, o1);
        if (packetId !== 0x00) return done({ online: false });
        const { value: jsonLen, offset: o3 } = readVarInt(data, o2);
        const json = JSON.parse(data.slice(o3, o3 + jsonLen).toString('utf8'));
        const desc = typeof json.description === 'string' ? json.description : (json.description?.text || '');
        done({ online: true, players: json.players?.online ?? null, maxPlayers: json.players?.max ?? null, map: null, version: json.version?.name || null, motd: desc });
      } catch {}
    });
    socket.on('timeout', () => done({ online: false }));
    socket.on('error', () => done({ online: false }));
    setTimeout(() => done({ online: false }), 6000);
  });
}

// --- Source engine A2S_INFO (Rust, CS2, TF2, GMod, ARK, Valheim…) ------------
async function querySource(host, port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const request = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from('Source Engine Query\0', 'utf8')]);
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { socket.close(); } catch {} resolve(r); } };
    const timer = setTimeout(() => finish({ online: false }), 5000);
    socket.on('message', (msg) => {
      try {
        if (msg[4] === 0x41) {
          // Challenge response — resend with the 4-byte challenge token.
          socket.send(Buffer.concat([request, msg.slice(5, 9)]), port, host);
          return;
        }
        if (msg[4] !== 0x49) return finish({ online: false });
        let off = 6; // header (4) + type (1) + protocol (1)
        const readStr = () => { const end = msg.indexOf(0, off); const s = msg.toString('utf8', off, end); off = end + 1; return s; };
        const name = readStr();
        const map = readStr();
        readStr(); // folder
        readStr(); // game
        off += 2; // app id
        const players = msg[off++];
        const maxPlayers = msg[off++];
        off += 1; // bots
        // server type, environment, visibility, VAC follow — not needed here.
        clearTimeout(timer);
        finish({ online: true, players, maxPlayers, map, version: null, motd: name });
      } catch { finish({ online: false }); }
    });
    socket.on('error', () => finish({ online: false }));
    socket.send(request, port, host, () => {});
  });
}

// --- Generic HTTP JSON endpoint -------------------------------------------------
async function queryHttp(host, port, extra = {}) {
  const url = extra.endpoint || `http://${host}:${port}/status`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { online: false };
    const json = await res.json();
    const online = extra.onlinePath ? Boolean(getPath(json, extra.onlinePath)) : true;
    return {
      online,
      players: extra.playersPath ? getPath(json, extra.playersPath) ?? null : null,
      maxPlayers: extra.maxPlayersPath ? getPath(json, extra.maxPlayersPath) ?? null : null,
      map: extra.mapPath ? getPath(json, extra.mapPath) ?? null : null,
      version: extra.versionPath ? getPath(json, extra.versionPath) ?? null : null,
      motd: extra.motdPath ? getPath(json, extra.motdPath) ?? null : null,
    };
  } catch { return { online: false }; }
}

async function queryManual() {
  // No public query protocol (e.g. The Isle Evrima). Status is informational
  // only — never fake an online/offline answer.
  return { online: null, players: null, maxPlayers: null, map: null, version: null, motd: 'No public query protocol — status must be checked manually.' };
}

const providers = {
  minecraft: { id: 'minecraft', name: 'Minecraft (Java)', query: (h, p, e) => queryMinecraft(h, p) },
  source: { id: 'source', name: 'Source Engine (A2S)', query: (h, p, e) => querySource(h, p) },
  http: { id: 'http', name: 'HTTP JSON endpoint', query: (h, p, e) => queryHttp(h, p, e) },
  manual: { id: 'manual', name: 'Manual (no query protocol)', query: () => queryManual() },
};

async function queryServer(server) {
  const provider = providers[server.provider];
  if (!provider) return { online: false, error: `Unknown provider: ${server.provider}` };
  try {
    return await provider.query(server.host, server.port, server.extra || {});
  } catch (err) {
    return { online: false, error: err.message };
  }
}

// Config-level defaults + per-guild DB entries.
function configServers() {
  return (config.gameServers?.custom || []).map((s) => ({ ...s, source: 'config', guild_id: null }));
}

async function dbServers(guildId) {
  if (!db.isEnabled()) return [];
  const rows = await db.query('SELECT * FROM game_servers WHERE guild_id = ? OR guild_id IS NULL', [guildId]) || [];
  return rows.map((r) => ({
    id: r.id, guild_id: r.guild_id, name: r.name, provider: r.provider,
    host: r.host, port: r.port, extra: r.extra ? JSON.parse(r.extra) : {},
    notify_channel_id: r.notify_channel_id, source: 'db',
  }));
}

async function allServers(guildId) {
  return [...configServers(), ...(await dbServers(guildId))];
}

async function recordStatus(serverId, status) {
  if (!db.isEnabled() || !serverId || typeof serverId !== 'number') return;
  await db.query('INSERT INTO game_server_status (server_id, online, players, checked_at) VALUES (?, ?, ?, NOW())',
    [serverId, status.online == null ? null : (status.online ? 1 : 0), status.players ?? null]);
}

async function checkAllGameServers(client) {
  if (!db.isEnabled()) return;
  const rows = await db.query('SELECT * FROM game_servers') || [];
  for (const row of rows) {
    const server = { ...row, extra: row.extra ? JSON.parse(row.extra) : {} };
    const status = await queryServer(server);
    await recordStatus(row.id, status);
    // Notify on transitions (offline -> online or online -> offline).
    const prev = await db.query('SELECT online FROM game_server_status WHERE server_id = ? ORDER BY checked_at DESC LIMIT 1, 1', [row.id]);
    const prevOnline = prev?.[0]?.online;
    if (row.notify_channel_id && prevOnline != null && status.online != null && prevOnline !== (status.online ? 1 : 0)) {
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.notify_channel_id);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [status.online
          ? infoEmbed('Server online', `🟢 **${row.name}** is back online (${status.players ?? '?'} players).`)
          : errorEmbed('Server offline', `🔴 **${row.name}** went offline.`)] }).catch(() => {});
      }
    }
  }
}

function startGameServerChecker(client) {
  const intervalMs = ((config.gameServers?.checkIntervalMinutes) || 5) * 60_000;
  setInterval(() => checkAllGameServers(client).catch(() => {}), intervalMs);
}

module.exports = { providers, queryServer, configServers, dbServers, allServers, recordStatus, checkAllGameServers, startGameServerChecker };
