// Shared "who did it" resolver (1.16.4): names the executor of a guild
// audit-log entry, for the member log and the message-delete log.
//
// Why a shared helper with a retry: the gateway event that triggers a log
// post (GuildMemberUpdate, MessageDelete, ...) can fire BEFORE Discord
// has written the matching audit-log entry, so a single immediate fetch
// finds nothing and the log reads "unknown" even though the entry exists
// a moment later — that is what happened to the bot's own autorole
// (1:27 PM join, 1:28 PM "Roles changed" with By: unknown; the two
// roles were added in one roles.add() by the bot itself, so the audit
// entry's executor IS the bot, it just was not written yet when the
// handler fetched). Fetching twice — once now, once ~1.5s later —
// closes that race. Entries come back newest-first, so .find still
// picks the newest match; the freshness window is 30s to cover the
// retry plus Discord's own write delay.
//
// Same contract as the old local helper in memberLogEvents.js (1.16.1):
// needs View Audit Log, matches an entry for the target, falls back to
// 'unknown' when there is no match, no permission, or the fetch fails,
// and never throws, so a failed lookup never breaks the log post.
// `extraMatch` is an optional extra predicate on the entry (e.g. the
// deleted message's channel for a MessageDelete entry).
async function resolveActor(guild, auditType, targetId, options = {}) {
  const {
    limit = 5,
    freshnessMs = 30_000,
    retryDelayMs = 1500,
    extraMatch = null,
  } = options;
  try {
    if (!guild.members.me?.permissions?.has('ViewAuditLog')) return 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      const logs = await guild.fetchAuditLogs({ type: auditType, limit });
      const entry = logs.entries.find((e) =>
        e.target?.id === targetId
        && Date.now() - e.createdAt.getTime() < freshnessMs
        && (!extraMatch || extraMatch(e)));
      if (entry?.executor) return `${entry.executor.tag} (<@${entry.executor.id}>)`;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

module.exports = { resolveActor };
