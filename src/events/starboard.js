// Starboard reactions: MessageReactionAdd / MessageReactionRemove.
// Partial reactions/messages are fetched first (index.js enables the
// Message + Reaction partials). See src/utils/starboard.js.
const { Events } = require('discord.js');
const { handleStarChange } = require('../utils/starboard');

module.exports = [
  {
    name: Events.MessageReactionAdd,
    async execute(reaction) {
      await handleStarChange(reaction, null);
    },
  },
  {
    name: Events.MessageReactionRemove,
    async execute(reaction) {
      await handleStarChange(reaction, null);
    },
  },
];
