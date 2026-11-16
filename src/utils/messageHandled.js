// Shared "already handled" marker for MessageCreate listeners.
// Custom commands mark a message handled so the FAQ responder (which runs
// after, alphabetically) skips it — a message gets at most one auto reply.
// Entries expire after 60s so the set can't grow unboundedly.
//
// Race note: the three MessageCreate listeners (custom commands, FAQ,
// autoresponder) all run concurrently on one event, and each only runs
// synchronously until its first await (a DB lookup). A plain
// isHandled() check followed later by markHandled() is therefore NOT
// atomic — all three listeners can pass the check before any of them
// marks the message, and a message matching two systems gets two
// replies. Use tryClaim() instead: the check and the add are adjacent
// synchronous statements, so on Node's single thread the claim is
// atomic. Claim immediately before replying, after the match is found.
const handled = new Set();

function markHandled(messageId) {
  handled.add(messageId);
  setTimeout(() => handled.delete(messageId), 60_000).unref?.();
}

function isHandled(messageId) {
  return handled.has(messageId);
}

// Atomically claim a message for replying. Returns false if another
// listener already claimed it (caller must not reply), true if this
// caller won the claim. No await between the check and the add.
function tryClaim(messageId) {
  if (handled.has(messageId)) return false;
  handled.add(messageId);
  setTimeout(() => handled.delete(messageId), 60_000).unref?.();
  return true;
}

module.exports = { markHandled, isHandled, tryClaim };
