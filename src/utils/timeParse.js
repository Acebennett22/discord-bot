// Time parsing for /schedule and /remindme.
// Accepts: "in 2h", "in 30m", "in 90s", "in 3d", "tomorrow 9am",
// "tomorrow 21:30", "2026-11-14 15:00", "2026-11-14T15:00", "9am", "21:30"
// (bare clock times mean today, or tomorrow if the time already passed).
// Returns a Date, or null when the input can't be parsed / is in the past.
function parseTime(input) {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  const now = new Date();

  // "in 2h" / "in 30m" / "in 90s" / "in 3d" / "in 1w"
  const inMatch = /^in\s+(\d+)\s*([smhdw])$/.exec(raw);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[inMatch[2]];
    if (n <= 0 || n > 365) return null;
    return new Date(now.getTime() + n * mult);
  }

  // "tomorrow 9am" / "tomorrow 21:30"
  const tomMatch = /^tomorrow\s+(.+)$/.exec(raw);
  if (tomMatch) {
    const t = parseClock(tomMatch[1]);
    if (!t) return null;
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(t.h, t.m, 0, 0);
    return d;
  }

  // ISO-ish: "2026-11-14 15:00" or "2026-11-14T15:00" (optional :ss).
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (isoMatch) {
    const d = new Date(
      parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10),
      parseInt(isoMatch[4], 10), parseInt(isoMatch[5], 10), parseInt(isoMatch[6] || '0', 10),
    );
    if (Number.isNaN(d.getTime()) || d <= now) return null;
    return d;
  }

  // Bare clock: "9am", "9:30pm", "21:30" — today, or tomorrow if passed.
  const clock = parseClock(raw);
  if (clock) {
    const d = new Date(now);
    d.setHours(clock.h, clock.m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

function parseClock(str) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(str.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const meridiem = m[3];
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === 'pm' && h !== 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
  } else if (h > 23) return null;
  if (min > 59) return null;
  return { h, m: min };
}

// Discord timestamp helper: <t:unix:R> renders as a relative time.
function discordTimestamp(date) {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
}

module.exports = { parseTime, parseClock, discordTimestamp };
