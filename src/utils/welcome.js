// Welcome / goodbye messages (per server, stored in guild_settings).
// Placeholders: {user} (mention), {username}, {server}, {membercount}.
// If no channel is configured (or the feature is toggled off), nothing is
// sent. A channel the bot can't post in is logged and skipped, never fatal.
const { infoEmbed } = require('./embeds');
const { getGuildSettings } = require('./guildSettings');
const { logWarn } = require('./errorLogger');

function formatMessage(template, member) {
  return String(template || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', String(member.guild.memberCount));
}

async function sendToChannel(guild, channelId, embed) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: 'channel not found or not text-based' };
  try {
    await channel.send({ embeds: [embed] });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function sendWelcome(member) {
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.welcomeEnabled || !settings.welcomeChannelId) return { sent: false };
  const text = formatMessage(settings.welcomeMessage, member);
  const result = await sendToChannel(member.guild, settings.welcomeChannelId,
    infoEmbed(`👋 Welcome to ${member.guild.name}!`, text));
  if (!result.ok) await logWarn('welcome: could not send welcome message', { guildId: member.guild.id, userId: member.id, error: result.reason });
  return { sent: result.ok };
}

async function sendGoodbye(member) {
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.goodbyeEnabled || !settings.goodbyeChannelId) return { sent: false };
  const text = formatMessage(settings.goodbyeMessage, member);
  const result = await sendToChannel(member.guild, settings.goodbyeChannelId,
    infoEmbed(`👋 ${member.user.username} left ${member.guild.name}`, text));
  if (!result.ok) await logWarn('welcome: could not send goodbye message', { guildId: member.guild.id, userId: member.id, error: result.reason });
  return { sent: result.ok };
}

module.exports = { formatMessage, sendWelcome, sendGoodbye };
