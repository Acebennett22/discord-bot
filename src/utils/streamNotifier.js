// Live stream notifications: Twitch (Helix), YouTube (Data API v3), Kick
// (public API v2). Facebook Live + TikTok have NO simple public live-status
// API — they are manual-only via /stream-announce (see README).
// Polls every streams.checkIntervalMinutes (default 5). Only posts on an
// offline -> live transition, never repeats. Missing credentials = that
// platform is skipped with a startup warning, the others keep checking.
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const config = require('./config');
const { isFeatureEnabled } = require('./featureToggles');
const { getTemplate, renderTemplate } = require('./liveChannelTemplate');
const { errorEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const cache = new Map(); // key -> { at, data }
// Pending live-channel renames (streamerId -> { channelId, name, guildId }).
// Discord allows ~2 channel renames per 10 min per channel; a failed rename
// is retried on the next check instead of crashing or spamming.
const pendingRenames = new Map();
const CACHE_MS = 4 * 60_000;
let twitchToken = null;
let twitchTokenExpires = 0;

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  return null;
}
function setCached(key, data) { cache.set(key, { at: Date.now(), data }); }

async function twitchAccessToken() {
  const tw = config.streams?.twitch || {};
  if (!tw.clientId || !tw.clientSecret || tw.clientId.includes('YOUR_')) return null;
  if (twitchToken && Date.now() < twitchTokenExpires) return twitchToken;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: tw.clientId, client_secret: tw.clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);
  const json = await res.json();
  twitchToken = json.access_token;
  twitchTokenExpires = Date.now() + (json.expires_in - 60) * 1000;
  return twitchToken;
}

async function checkTwitch(login) {
  const key = `twitch:${login}`;
  const hit = cached(key);
  if (hit) return hit;
  const token = await twitchAccessToken();
  if (!token) return null;
  const tw = config.streams.twitch;
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { 'Client-Id': tw.clientId, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Twitch Helix failed: ${res.status}`);
  const json = await res.json();
  const s = json.data?.[0];
  const result = s ? {
    live: true, id: s.id, title: s.title, game: s.game_name,
    viewers: s.viewer_count, thumbnail: s.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
    url: `https://twitch.tv/${s.user_login}`,
  } : { live: false };
  setCached(key, result);
  return result;
}

async function checkYouTube(channelId) {
  const key = `youtube:${channelId}`;
  const hit = cached(key);
  if (hit) return hit;
  const apiKey = config.streams?.youtube?.apiKey;
  if (!apiKey || apiKey.includes('YOUR_')) return null;
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API failed: ${res.status}`);
  const json = await res.json();
  const item = json.items?.[0];
  const result = item ? {
    live: true, id: item.id.videoId, title: item.snippet.title, game: '',
    viewers: null, thumbnail: item.snippet.thumbnails?.high?.url || null,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  } : { live: false };
  setCached(key, result);
  return result;
}

async function checkKick(slug) {
  const key = `kick:${slug}`;
  const hit = cached(key);
  if (hit) return hit;
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': 'ace-discord-bot/1.0' },
  });
  if (!res.ok) throw new Error(`Kick API failed: ${res.status}`);
  const json = await res.json();
  const live = json.livestream;
  const result = live ? {
    live: true, id: String(live.id), title: live.session_title, game: live.categories?.[0]?.name || '',
    viewers: live.viewer_count, thumbnail: live.thumbnail?.url || null,
    url: `https://kick.com/${json.slug}`,
  } : { live: false };
  setCached(key, result);
  return result;
}

const CHECKERS = { twitch: checkTwitch, youtube: checkYouTube, kick: checkKick };

// Latest clip / video for a live announcement (1.4.5). Twitch uses the
// Helix clips endpoint (same client ID/secret as the live checks). YouTube
// has no public clips API, so the latest video is attached instead. If
// nothing is found (or the fetch fails), the announcement goes out without
// one — the clip fetch must never fail a live announcement.
async function fetchLatestClip(platform, channelIdOrName) {
  try {
    if (platform === 'twitch') {
      const token = await twitchAccessToken();
      const tw = config.streams?.twitch || {};
      if (!token) return null;
      const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channelIdOrName)}`, {
        headers: { 'Client-Id': tw.clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const userJson = await userRes.json().catch(() => null);
      const broadcasterId = userJson?.data?.[0]?.id;
      if (!broadcasterId) return null;
      const res = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=1`, {
        headers: { 'Client-Id': tw.clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => null);
      const clip = json?.data?.[0];
      return clip ? { title: clip.title, url: clip.url, thumbnail: clip.thumbnail_url || null, type: 'clip' } : null;
    }
    if (platform === 'youtube') {
      const apiKey = config.streams?.youtube?.apiKey;
      if (!apiKey || apiKey.includes('YOUR_')) return null;
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelIdOrName)}&type=video&order=date&maxResults=1&key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => null);
      const item = json?.items?.[0];
      return item ? { title: item.snippet.title, url: `https://www.youtube.com/watch?v=${item.id.videoId}`, thumbnail: item.snippet.thumbnails?.medium?.url || null, type: 'latest video' } : null;
    }
  } catch (err) {
    await errorLogger.log({ level: 'warn', guildId: null, commandName: 'stream-clip', message: `Latest clip fetch failed for ${platform}/${channelIdOrName}: ${err.message}`, stack: err.stack }).catch(() => {});
  }
  return null;
}

// Attach the latest clip / latest video field to a live embed (1.15.24).
// Shared by the live notifier and the dashboard preview so the preview
// cannot drift from the real announcement.
function addClipField(embed, clip) {
  if (!clip) return embed;
  embed.addFields({ name: clip.type === 'clip' ? '🎬 Latest clip' : '📺 Latest video', value: `[${clip.title}](${clip.url})` });
  return embed;
}

function liveEmbed(platform, name, data) {
  const colors = { twitch: 0x9146ff, youtube: 0xff0000, kick: 0x53fc18, facebook: 0x1877f2, tiktok: 0x25f4ee };
  const embed = new EmbedBuilder()
    .setColor(colors[platform] || 0x5865f2)
    .setTitle(`🔴 ${name} is live on ${platform[0].toUpperCase() + platform.slice(1)}!`)
    .setDescription(data.title ? `**${data.title}**` : 'Stream is live!')
    .setURL(data.url || null)
    .setTimestamp();
  if (data.game) embed.addFields({ name: 'Category', value: data.game, inline: true });
  if (data.viewers != null) embed.addFields({ name: 'Viewers', value: String(data.viewers), inline: true });
  if (data.thumbnail) embed.setImage(data.thumbnail);
  return embed;
}

async function fetchChannel(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  return guild?.channels.cache.get(channelId) || await guild?.channels.fetch(channelId).catch(() => null);
}

async function applyLiveChannelRename(client, row, { live, title, game }) {
  if (!row.live_channel_id) return;
  const channel = await fetchChannel(client, row.guild_id, row.live_channel_id);
  if (!channel) { console.warn(`[streams] live channel ${row.live_channel_id} not found for streamer ${row.channel_id_or_name}`); return; }
  let targetName;
  if (live) {
    // Remember the original name once, so offline restores it exactly.
    if (!row.live_channel_original_name) {
      await db.query('UPDATE streamers SET live_channel_original_name = ? WHERE id = ?', [channel.name, row.id]);
      row.live_channel_original_name = channel.name;
    }
    const template = await getTemplate(row.guild_id);
    targetName = renderTemplate(template, { name: row.channel_id_or_name, game, title });
  } else {
    targetName = row.live_channel_original_name || null;
  }
  if (!targetName || channel.name === targetName) return;
  try {
    await channel.setName(targetName);
    pendingRenames.delete(row.id);
  } catch (err) {
    console.warn(`[streams] rename of live channel ${row.live_channel_id} failed (${err.message}) — will retry on next check.`);
    pendingRenames.set(row.id, { channelId: row.live_channel_id, name: targetName, guildId: row.guild_id });
  }
}

async function retryPendingRenames(client) {
  for (const [id, job] of pendingRenames) {
    const channel = await fetchChannel(client, job.guildId, job.channelId);
    if (!channel) { pendingRenames.delete(id); continue; }
    if (channel.name === job.name) { pendingRenames.delete(id); continue; }
    try { await channel.setName(job.name); pendingRenames.delete(id); }
    catch (err) { console.warn(`[streams] pending rename retry failed for ${job.channelId}:`, err.message); }
  }
}

async function checkAllStreams(client) {
  if (!db.isEnabled()) return;
  await retryPendingRenames(client).catch(() => {});
  const rows = await db.query('SELECT * FROM streamers');
  if (!rows?.length) return;
  for (const row of rows) {
    if (!(await isFeatureEnabled('streams', row.guild_id))) continue;
    const checker = CHECKERS[row.platform];
    if (!checker) continue; // facebook / tiktok: manual-only, no API check
    let status;
    try { status = await checker(row.channel_id_or_name); } catch (err) {
      await errorLogger.log({ level: 'warn', guildId: row.guild_id, commandName: 'stream-check', message: `${row.platform} check failed for ${row.channel_id_or_name}: ${err.message}`, stack: err.stack });
      continue;
    }
    if (!status) continue; // credentials missing for this platform
    const wasLive = Boolean(row.is_live);
    const nowLive = status.live;
    const newLiveId = nowLive ? status.id : row.last_live_id;
    if (nowLive && (!wasLive || row.last_live_id !== status.id)) {
      await applyLiveChannelRename(client, row, { live: true, title: status.title, game: status.game }).catch(() => {});
      // Offline -> live transition: announce once.
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.notify_channel_id)
        || await guild?.channels.fetch(row.notify_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const ping = row.ping_role_id ? `<@&${row.ping_role_id}> ` : '';
        const embed = liveEmbed(row.platform, row.channel_id_or_name, status);
        // Attach the latest clip (Twitch) or latest video (YouTube) when
        // the streamer has clips enabled — never blocks the announcement.
        if (row.include_clip !== 0) {
          const clip = await fetchLatestClip(row.platform, row.channel_id_or_name).catch(() => null);
          if (clip) addClipField(embed, clip);
        }
        await channel.send({ content: `${ping}🔴 **${row.channel_id_or_name}** just went live!`, embeds: [embed] }).catch(() => {});
      }
    } else if (!nowLive && wasLive) {
      await applyLiveChannelRename(client, row, { live: false }).catch(() => {});
      if (config.streams?.announceOfflineMessage) {
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.notify_channel_id);
      if (channel?.isTextBased()) await channel.send({ embeds: [errorEmbed('Stream ended', `⚫ **${row.channel_id_or_name}**'s stream has ended.`)] }).catch(() => {});
      }
    }
    if (nowLive !== wasLive || newLiveId !== row.last_live_id) {
      await db.query('UPDATE streamers SET is_live = ?, last_live_id = ? WHERE id = ?', [nowLive ? 1 : 0, newLiveId, row.id]);
    }
  }
}

function startStreamChecker(client) {
  const tw = config.streams?.twitch || {};
  const yt = config.streams?.youtube || {};
  if (!tw.clientId || tw.clientId.includes('YOUR_')) console.warn('[streams] Twitch not configured (streams.twitch clientId/secret) — Twitch checks skipped.');
  if (!yt.apiKey || yt.apiKey.includes('YOUR_')) console.warn('[streams] YouTube not configured (streams.youtube.apiKey) — YouTube checks skipped.');
  console.log('[streams] Kick checks need no key. Facebook/TikTok are manual-only (/stream-announce).');
  const intervalMs = (config.streams?.checkIntervalMinutes || 5) * 60_000;
  setInterval(() => checkAllStreams(client).catch((e) => console.warn('[streams] check failed:', e.message)), intervalMs);
  // First check shortly after startup.
  setTimeout(() => checkAllStreams(client).catch(() => {}), 30_000);
}

// Re-check one streamer right now (dashboard "Refresh" button).
async function checkOneStreamer(client, streamerId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM streamers WHERE id = ?', [streamerId]);
  const row = rows?.[0];
  if (!row) return null;
  const checker = CHECKERS[row.platform];
  if (!checker) return { live: Boolean(row.is_live), manual: true };
  let status;
  try { status = await checker(row.channel_id_or_name); } catch { return { live: Boolean(row.is_live), error: true }; }
  if (!status) return { live: Boolean(row.is_live), error: true };
  if (status.live && !row.is_live) {
    await applyLiveChannelRename(client, row, { live: true, title: status.title, game: status.game }).catch(() => {});
  } else if (!status.live && row.is_live) {
    await applyLiveChannelRename(client, row, { live: false }).catch(() => {});
  }
  await db.query('UPDATE streamers SET is_live = ?, last_live_id = ? WHERE id = ?',
    [status.live ? 1 : 0, status.live ? status.id : row.last_live_id, row.id]);
  return { live: status.live, title: status.title || null, game: status.game || null, viewers: status.viewers ?? null, url: status.url || null };
}

module.exports = { checkAllStreams, startStreamChecker, liveEmbed, addClipField, CHECKERS, checkOneStreamer, applyLiveChannelRename, fetchLatestClip };
