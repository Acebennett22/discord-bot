// Bot tracking on join — a separate GuildMemberAdd listener so the
// welcome/goodbye handler in guildMemberAdd.js is never touched.
// Scores the new member, logs flags/stats, applies the guild's auto-action.
const { Events } = require('discord.js');
const { handleJoin } = require('../utils/botTracker');
const { logError } = require('../utils/errorLogger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      await handleJoin(member);
    } catch (err) {
      await logError(err, { command: 'botTrackerJoin', guildId: member?.guild?.id, userId: member?.user?.id }).catch(() => {});
    }
  },
};
