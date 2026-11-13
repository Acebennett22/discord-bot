// Poll voting: reaction add/remove on a poll message. One vote per user —
// reacting with a different number moves the vote; removing a reaction
// removes the vote. The tally embed is re-rendered on every change.
// Partial reactions are fetched first (index.js enables partials).
const { Events } = require('discord.js');
const { NUMBER_EMOJIS, getPollByMessage, saveVotes, refreshPollMessage } = require('../utils/polls');

async function handleVote(reaction, user, added) {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const message = reaction.message;
    if (message.partial) await message.fetch().catch(() => null);
    if (!message.guild) return;
    const emoji = reaction.emoji.name;
    const idx = NUMBER_EMOJIS.indexOf(emoji);
    if (idx === -1) return;
    const poll = await getPollByMessage(message.id);
    if (!poll || poll.ended || idx >= poll.options.length) return;
    if (added) {
      const previous = poll.votes[user.id];
      poll.votes[user.id] = idx;
      await saveVotes(poll);
      // One vote per user: remove their reaction on any other option.
      if (previous !== undefined && previous !== idx) {
        try {
          const oldReaction = message.reactions.cache.get(NUMBER_EMOJIS[previous]);
          await oldReaction?.users.remove(user.id).catch(() => {});
        } catch {}
      }
    } else if (poll.votes[user.id] === idx) {
      delete poll.votes[user.id];
      await saveVotes(poll);
    } else return;
    await refreshPollMessage(message.client, poll);
  } catch {}
}

module.exports = [
  {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) { await handleVote(reaction, user, true); },
  },
  {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) { await handleVote(reaction, user, false); },
  },
];
