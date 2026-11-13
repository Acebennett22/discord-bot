// Invite lifecycle events: keep the invite cache fresh and attribute joins/leaves.
const { Events } = require('discord.js');
const tracker = require('../utils/inviteTracker');

module.exports = [
  {
    name: Events.InviteCreate,
    async execute(invite) { await tracker.refreshGuildInvites(invite.guild); },
  },
  {
    name: Events.InviteDelete,
    async execute(invite) { await tracker.refreshGuildInvites(invite.guild); },
  },
  {
    name: Events.GuildMemberAdd,
    async execute(member) { await tracker.recordJoin(member).catch((e) => console.warn('[invites] recordJoin failed:', e.message)); },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member) { await tracker.recordLeave(member).catch((e) => console.warn('[invites] recordLeave failed:', e.message)); },
  },
];
