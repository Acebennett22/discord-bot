// Anti-ghost-ping (1.5.3): when a message that mentioned someone is deleted,
// call it out. Bot-deleted messages are ignored via a short in-memory set
// of message IDs the bot itself deleted (automod/purge/etc. record them
// here) — the audit log is too slow/racy for this, so the set is the
// documented approach. Content is redacted the same way the modlog does
// (token/password patterns). Rate limit: max 1 callout per user per minute.
const { Events } = require('discord.js');
const db = require('../utils/database');
const { getGuildSettings } = require('../utils/guildSettings');
const { errorEmbed } = require('../utils/embeds');

const SECRET_PATTERN = /(token|password|passwd|secret|api[-_]?key|apikey|auth)[\s=:]+[^\s]{4,}/gi;
const DISCORD_TOKEN = /[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27}/g;

function redact(text) {
  if (!text) return text;
  return text.replace(SECRET_PATTERN, '$1: [REDACTED]').replace(DISCORD_TOKEN, '[REDACTED TOKEN]');
}

// Message IDs the bot deleted itself (automod, purge, etc.) — call
// markBotDeleted(id) before deleting so the ghost-ping handler skips it.
// Entries expire after 60 seconds.
const botDeleted = new Set();
function markBotDeleted(messageId) {
  botDeleted.add(messageId);
  setTimeout(() => botDeleted.delete(messageId), 60_000);
}

const lastCalloutByUser = new Map(); // userId -> timestamp
function isRateLimited(userId) {
  const last = lastCalloutByUser.get(userId) || 0;
  if (Date.now() - last < 60_000) return true;
  lastCalloutByUser.set(userId, Date.now());
  return false;
}

function mentionsAnyone(message) {
  const mentions = message.mentions || {};
  return (mentions.users?.size || 0) > 0 || (mentions.roles?.size || 0) > 0 || (mentions.everyone || false);
}

function ghostPingEmbed(message) {
  const who = [...(message.mentions?.users?.values() || [])].map((u) => `<@${u.id}>`)
    .concat([...(message.mentions?.roles?.values() || [])].map((r) => `<@&${r.id}>`))
    .concat(message.mentions?.everyone ? ['@everyone'] : []);
  const content = redact(message.content || '');
  return errorEmbed('👻 Ghost ping!', `${message.author} deleted a message that mentioned ${who.join(', ')}.\n\n${content ? `> ${content.slice(0, 500)}` : '*[no text]*'}`);
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;
    if (botDeleted.has(message.id)) return;
    if (!mentionsAnyone(message)) return;
    const settings = await getGuildSettings(message.guild.id).catch(() => null);
    if (!settings?.ghostpingEnabled) return;
    if (isRateLimited(message.author.id)) return;
    const target = settings.ghostpingChannelId
      ? message.guild.channels.cache.get(settings.ghostpingChannelId) || await message.guild.channels.fetch(settings.ghostpingChannelId).catch(() => null)
      : message.channel;
    if (!target?.isTextBased()) return;
    await target.send({ embeds: [ghostPingEmbed(message)] }).catch(() => {});
  },
  markBotDeleted,
  mentionsAnyone,
  redact,
  ghostPingEmbed,
};
