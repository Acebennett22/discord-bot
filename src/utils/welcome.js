// Welcome / goodbye messages (per server, stored in guild_settings).
// Placeholders: {user} (mention), {username}, {server}, {membercount}.
// If no channel is configured (or the feature is toggled off), nothing is
// sent. A channel the bot can't post in is logged and skipped, never fatal.
const { infoEmbed } = require('./embeds');
const { getGuildSettings } = require('./guildSettings');
const { logWarn } = require('./errorLogger');
const { generateWelcomeCard, canvasAvailable } = require('./welcomeCard');

function formatMessage(template, member) {
  return String(template || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', String(member.guild.memberCount));
}

async function sendToChannel(guild, channelId, payload) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: 'channel not found or not text-based' };
  try {
    await channel.send(payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function sendWelcome(member) {
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.welcomeEnabled || !settings.welcomeChannelId) return { sent: false };
  const text = formatMessage(settings.welcomeMessage, member);
  // Custom welcome image (1.3.6): generate a card; if canvas is unavailable
  // or generation fails, fall back to the plain embed — never break joins.
  let imageBuffer = null;
  if (settings.welcomeImageEnabled) {
    if (!canvasAvailable) {
      await logWarn('welcome: canvas unavailable — welcome image skipped', { guildId: member.guild.id, userId: member.id });
    } else {
      try {
        imageBuffer = await generateWelcomeCard({
          username: member.user.username,
          avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
          serverName: member.guild.name,
          memberCount: member.guild.memberCount,
        });
      } catch (err) {
        await logWarn('welcome: card generation failed', { guildId: member.guild.id, userId: member.id, error: err.message });
      }
    }
  }
  const payload = settings.welcomeImageOnly && imageBuffer
    ? { files: [{ attachment: imageBuffer, name: 'welcome.png' }] }
    : {
        embeds: [infoEmbed(`👋 Welcome to ${member.guild.name}!`, text)],
        ...(imageBuffer ? { files: [{ attachment: imageBuffer, name: 'welcome.png' }] } : {}),
      };
  const result = await sendToChannel(member.guild, settings.welcomeChannelId, payload);
  if (!result.ok) await logWarn('welcome: could not send welcome message', { guildId: member.guild.id, userId: member.id, error: result.reason });
  return { sent: result.ok };
}

async function sendGoodbye(member) {
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.goodbyeEnabled || !settings.goodbyeChannelId) return { sent: false };
  const text = formatMessage(settings.goodbyeMessage, member);
  const result = await sendToChannel(member.guild, settings.goodbyeChannelId,
    { embeds: [infoEmbed(`👋 ${member.user.username} left ${member.guild.name}`, text)] });
  if (!result.ok) await logWarn('welcome: could not send goodbye message', { guildId: member.guild.id, userId: member.id, error: result.reason });
  return { sent: result.ok };
}

module.exports = { formatMessage, sendWelcome, sendGoodbye };
