// Shared "already handled" marker for MessageCreate listeners.
// Custom commands mark a message handled so the FAQ responder (which runs
// after, alphabetically) skips it — a message gets at most one auto reply.
// Entries expire after 60s so the set can't grow unboundedly.
const handled = new Set();

function markHandled(messageId) {
  handled.add(messageId);
  setTimeout(() => handled.delete(messageId), 60_000).unref?.();
}

function isHandled(messageId) {
  return handled.has(messageId);
}

module.exports = { markHandled, isHandled };
