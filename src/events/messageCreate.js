// XP awarding on messages (leveling) + Automod checks — bots and DMs ignored.
// Automod runs first: a message it deletes doesn't earn XP.
const { Events } = require('discord.js');
const { awardXp } = require('../utils/leveling');
const automod = require('../utils/automod');
const autoresponders = require('../utils/autoresponders');
const sticky = require('../utils/sticky');
const { recordMessage } = require('../utils/analytics');
const { getGuildSettings } = require('../utils/guildSettings');
const { askAI, isAiConfigured } = require('../utils/ai');
const { isHandled } = require('../utils/messageHandled');
const { handleTranslateMessage } = require('../utils/translate');
const { infoEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    recordMessage(message.guildId);
    const actioned = await automod.handleMessage(message).catch(() => null);
    if (actioned?.deleted) return;
    // Autoresponder (1.14.3): phrase triggers reply after Automod, so a
    // deleted message never gets a reply. Marks the message handled so the
    // FAQ responder won't double-reply.
    await autoresponders.handleMessage(message).catch(() => {});
    // Auto-translate (1.10.6): watched channels get non-target-language
    // messages translated in a reply. Never fatal, never blocks XP.
    await handleTranslateMessage(message).catch(() => {});
    // Sticky messages (1.15.15): re-post the channel's sticky at the bottom
    // when a new message pushed it up. Never fatal, never blocks XP.
    await sticky.handleMessage(message).catch(() => {});
    // AI chat channel (1.4.1): plain messages here are questions for the AI.
    // Skipped when an auto-reply already claimed the message, so a message
    // in the AI channel that also matched an autoresponder/FAQ/custom
    // command doesn't get both the auto-reply and an AI answer.
    const settings = await getGuildSettings(message.guildId).catch(() => null);
    if (settings?.aiEnabled && settings.aiChannelId === message.channelId && isAiConfigured() && !message.content.startsWith('!') && !isHandled(message.id)) {
      const result = await askAI({
        guildId: message.guildId, guildName: message.guild.name, userId: message.author.id,
        channelId: message.channelId, question: message.content,
      }).catch(() => null);
      if (result?.ok) await message.reply({ embeds: [infoEmbed('💬 AI answer', result.reply)] }).catch(() => {});
      else if (result) await message.reply(result.error).catch(() => {});
    }
    await awardXp(message).catch(() => {});
  },
};
