// Ticket transcript index: transcripts are HTML files in transcripts/
// (written by src/utils/transcript.js); ticket_transcripts indexes them so
// staff can list/search/view them on the dashboard. Backfill matches files
// to tickets by their stored transcript_path.
const fs = require('fs');
const path = require('path');
const db = require('./database');

const TRANSCRIPTS_DIR = path.join(__dirname, '..', '..', 'transcripts');

async function indexTranscript({ guildId, ticketId, userId, closedBy, filePath }) {
  if (!db.isEnabled() || !filePath) return false;
  await db.query(
    'INSERT INTO ticket_transcripts (guild_id, ticket_id, user_id, closed_by, file_path) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE closed_at = CURRENT_TIMESTAMP',
    [guildId, ticketId ?? null, userId ?? null, closedBy ?? null, filePath],
  );
  return true;
}

// One-time backfill: for every transcript file on disk, find the ticket
// whose transcript_path points at it and index it. Idempotent — the
// file_path unique key makes re-runs no-ops.
async function backfillTranscripts() {
  if (!db.isEnabled()) return 0;
  let dir;
  try { dir = fs.readdirSync(TRANSCRIPTS_DIR); } catch { return 0; }
  const files = dir.filter((f) => f.endsWith('.html'));
  if (!files.length) return 0;
  const tickets = await db.query('SELECT id, guild_id, user_id, transcript_path FROM tickets WHERE transcript_path IS NOT NULL') || [];
  const byPath = new Map(tickets.map((t) => [t.transcript_path, t]));
  let added = 0;
  for (const file of files) {
    const full = path.join(TRANSCRIPTS_DIR, file);
    const ticket = byPath.get(full) || [...byPath.values()].find((t) => String(t.transcript_path || '').endsWith(file));
    if (!ticket) continue;
    const done = await indexTranscript({
      guildId: ticket.guild_id, ticketId: ticket.id, userId: ticket.user_id,
      closedBy: null, filePath: full,
    }).catch(() => false);
    if (done) added += 1;
  }
  return added;
}

module.exports = { indexTranscript, backfillTranscripts, TRANSCRIPTS_DIR };
