// Purge filter helper — pure logic, no Discord/DB calls, so it is
// stub-testable without a client.
// Classification order, applied only to messages that MATCH the filter
// (user and/or contains): pinned first, then older than 14 days, then
// deletable. Messages that don't match the filter are ignored entirely,
// so deletable + skippedOld + skippedPinned === number of matches.
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function isTooOld(message, now = Date.now()) {
  const created = message.createdTimestamp ?? (message.createdAt ? new Date(message.createdAt).getTime() : NaN);
  if (!Number.isFinite(created)) return false;
  return now - created > FOURTEEN_DAYS_MS;
}

function matchesFilter(message, { userId, containsText } = {}) {
  if (userId && message.author?.id !== userId) return false;
  if (containsText && !String(message.content || '').toLowerCase().includes(containsText.toLowerCase())) return false;
  return true;
}

// messages: an Array or a discord.js Collection (anything iterable, or with
// .values()). `now` is injectable for tests (defaults to Date.now()).
// Returns { deletable, skippedOld, skippedPinned } (arrays of the original
// message objects, in the order given).
function filterMessages(messages, { userId, containsText, now = Date.now() } = {}) {
  const list = Array.isArray(messages)
    ? messages
    : (typeof messages?.values === 'function' ? [...messages.values()] : [...(messages || [])]);
  const deletable = [];
  const skippedOld = [];
  const skippedPinned = [];
  for (const message of list) {
    if (!matchesFilter(message, { userId, containsText })) continue;
    if (message.pinned) { skippedPinned.push(message); continue; }
    if (isTooOld(message, now)) { skippedOld.push(message); continue; }
    deletable.push(message);
  }
  return { deletable, skippedOld, skippedPinned };
}

module.exports = { FOURTEEN_DAYS_MS, isTooOld, matchesFilter, filterMessages };
