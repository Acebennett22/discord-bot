// Custom trigger-word commands (MessageCreate). A message that exactly
// matches (or starts with) a registered trigger gets the stored reply.
// Runs before the FAQ responder (alphabetical load order) and marks the
// message handled so the FAQ responder skips it. Built-in slash command
// names can never be triggers (enforced in /custom-add).
const { Events } = require('discord.js');
const { findCustomCommand, incrementUse, sanitizeResponse } = require('../utils/customCommands');
const { markHandled } = require('../utils/messageHandled');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    const content = message.content.trim();
    if (!content || content.startsWith('/')) return;
    try {
      const firstWord = content.split(/\s+/)[0].toLowerCase();
      let hit = await findCustomCommand(message.guild.id, firstWord);
      if (!hit && content.toLowerCase() !== firstWord) {
        // Also allow the whole message as a multi-word trigger.
        hit = await findCustomCommand(message.guild.id, content.toLowerCase());
      }
      if (!hit) return;
      markHandled(message.id);
      await message.reply({ content: sanitizeResponse(hit.response) }).catch(() => {});
      await incrementUse(message.guild.id, hit.trigger_word).catch(() => {});
    } catch {}
  },
};
