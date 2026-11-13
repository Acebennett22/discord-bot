// Anti-nuke event listeners (1.9.6). Exported as an ARRAY —
// src/handlers/eventHandler.js accepts either a single { name, execute }
// or an array of them (same pattern as src/events/inviteEvents.js).
// Detection is BEST-EFFORT: the executor of each deletion/creation is
// resolved from the guild audit log (guild.fetchAuditLogs), which is the
// only source Discord provides for "who did it" — and audit logs can lag
// a few seconds or be unavailable (missing View Audit Log permission, or
// Discord delays). Events with no resolvable executor are recorded as
// unknown and skipped: the bot never guesses who to punish. The bot can
// only act AFTER the damage has started; it cannot prevent the first
// deletions. All counting/action logic lives in src/utils/antinuke.js.
const { Events, AuditLogEvent } = require('discord.js');
const { recordEvent, checkThreshold, takeAction } = require('../utils/antinuke');

const AUDIT_RECENT_MS = 30_000; // audit entries older than this are stale

// Best-effort executor lookup: prefer an entry whose target matches and
// which is fresh; otherwise fall back to the freshest entry of that type.
// Returns a user id string, or null when nothing usable is found.
async function resolveExecutor(guild, auditType, targetId) {
  let logs;
  try {
    logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
  } catch {
    return null; // no View Audit Log permission, or Discord error
  }
  const entries = [...(logs?.entries?.values() || [])];
  const fresh = entries.filter((e) => Date.now() - e.createdTimestamp < AUDIT_RECENT_MS);
  const match = targetId
    ? fresh.find((e) => e.target?.id === targetId)
    : fresh[0];
  const chosen = match || fresh[0];
  return chosen?.executor?.id || null;
}

// Shared pipeline: record the action, and if the user hit the threshold,
// take the configured action. The bot's own actions and the guild owner's
// are never counted — the bot deletes channels itself (tickets, temp VC),
// and the owner can never be acted on.
async function handleDestructive(guild, client, executorId, action, targetId) {
  if (!guild || !executorId) return;
  if (client?.user && executorId === client.user.id) return;
  if (executorId === guild.ownerId) return;
  const count = await recordEvent(guild.id, executorId, action, targetId);
  if (count === 0) return;
  if (!(await checkThreshold(guild, executorId).catch(() => false))) return;
  const user = await client.users.fetch(executorId).catch(() => null);
  if (!user) return;
  await takeAction(guild, user).catch(() => {});
}

module.exports = [
  {
    name: Events.ChannelDelete,
    async execute(channel, client) {
      if (!channel?.guild) return;
      const executorId = await resolveExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
      await handleDestructive(channel.guild, client, executorId, 'channel_delete', channel.id);
    },
  },
  {
    name: Events.ChannelCreate,
    async execute(channel, client) {
      if (!channel?.guild) return;
      // Channel-creation bursts (mass channel spam). Single legitimate
      // creates count too, but one create is far below the threshold.
      const executorId = await resolveExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
      await handleDestructive(channel.guild, client, executorId, 'channel_create', channel.id);
    },
  },
  {
    name: Events.GuildRoleDelete,
    async execute(role, client) {
      if (!role?.guild) return;
      const executorId = await resolveExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
      await handleDestructive(role.guild, client, executorId, 'role_delete', role.id);
    },
  },
  {
    name: Events.GuildBanAdd,
    async execute(ban, client) {
      if (!ban?.guild) return;
      const executorId = await resolveExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user?.id);
      await handleDestructive(ban.guild, client, executorId, 'member_ban', ban.user?.id);
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
      if (!member?.guild) return;
      // A plain leave has no kick audit entry, so resolveExecutor returns
      // null and nothing happens. A kick resolves to the kicker.
      const executorId = await resolveExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
      await handleDestructive(member.guild, client, executorId, 'member_kick', member.id);
    },
  },
];
