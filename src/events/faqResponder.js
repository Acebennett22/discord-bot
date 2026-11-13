// FAQ auto-responder (MessageCreate). Runs after the custom-command handler
// (alphabetical load order) and skips any message a custom command already
// handled, slash-command-looking messages, bots, and DMs. Replies with an
// embed — PUBLIC by design, that's the point of an FAQ responder. One
// response per message; FAQ replies never trigger other FAQ/custom
// responses (bot messages are skipped, and handled messages are marked).
const { Events } = require('discord.js');
const { getFaqs, matchFaq, incrementFaqUse } = require('../utils/faq');
const { isHandled, markHandled } = require('../utils/messageHandled');
const { infoEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (message.content.startsWith('/')) return; // looks like a command
    if (isHandled(message.id)) return; // custom command already replied
    try {
      const faqs = await getFaqs(message.guild.id);
      if (!faqs.length) return;
      const hit = matchFaq(faqs, message.content);
      if (!hit) return;
      markHandled(message.id);
      await message.reply({ embeds: [infoEmbed('💬 FAQ', hit.response)] }).catch(() => {});
      await incrementFaqUse(hit.id).catch(() => {});
    } catch {}
  },
};
