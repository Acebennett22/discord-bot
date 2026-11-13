// Minecraft live status widget (1.4.2): one embed message per widget that is
// updated every 5 minutes (config gameServers.mcStatusIntervalSeconds,
// default 300). Reuses the existing Minecraft ping provider from
// gameServers.js — no second ping implementation. Offline servers show an
// offline embed instead of erroring; player names come from the ping's
// sample list (up to 10), which some servers don't provide.
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const config = require('./config');
const { queryServer } = require('./gameServers');
const { logWarn } = require('./errorLogger');

function widgetEmbed(server, status) {
  if (!status?.online) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`🔴 ${server.name} — Offline`)
      .setDescription('The server is currently offline.')
      .setTimestamp();
  }
  const sample = (status.sample || []).slice(0, 10);
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🟢 ${server.name} — Online`)
    .setDescription([
      `**Players:** ${status.players ?? '?'}${status.maxPlayers != null ? ` / ${status.maxPlayers}` : ''}`,
      status.version ? `**Version:** ${status.version}` : null,
      status.motd ? `**MOTD:** ${String(status.motd).slice(0, 200)}` : null,
      sample.length ? `**Online:** ${sample.join(', ')}` : null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Updated' })
    .setTimestamp();
}

async function updateWidget(client, widget) {
  const rows = await db.query('SELECT * FROM game_servers WHERE id = ?', [widget.server_id]);
  const server = rows?.[0];
  if (!server) return;
  const status = await queryServer({ ...server, extra: server.extra ? JSON.parse(server.extra) : {} });
  const channel = await client.channels.fetch(widget.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const embed = widgetEmbed(server, status);
  if (widget.message_id) {
    const msg = await channel.messages.fetch(widget.message_id).catch(() => null);
    if (msg) { await msg.edit({ embeds: [embed] }).catch(() => {}); return; }
  }
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) await db.query('UPDATE mc_widgets SET message_id = ? WHERE id = ?', [sent.id, widget.id]).catch(() => {});
}

async function updateAllWidgets(client) {
  if (!db.isEnabled()) return;
  const widgets = await db.query('SELECT * FROM mc_widgets') || [];
  for (const w of widgets) {
    await updateWidget(client, w).catch((e) => logWarn('mc-widget update failed', { error: e.message }));
  }
}

let started = false;
function startMcWidgetChecker(client) {
  if (started) return;
  started = true;
  const seconds = config.gameServers?.mcStatusIntervalSeconds || 300;
  setInterval(() => updateAllWidgets(client).catch(() => {}), seconds * 1000);
  setTimeout(() => updateAllWidgets(client).catch(() => {}), 30_000);
}

module.exports = { widgetEmbed, updateWidget, updateAllWidgets, startMcWidgetChecker };
