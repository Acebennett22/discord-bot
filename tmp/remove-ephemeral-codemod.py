#!/usr/bin/env python3
"""Codemod for 1.15.7: remove `ephemeral: true` from interaction replies.

Ace asked for public (non-ephemeral) replies everywhere except a small
audited list of keep-sites (private data + per-click confirmations that
would spam the channel / spoil a game). This script removes the flag
syntactically safely and reports exactly what it kept, removed, and
could not handle.

Usage:
  python3 tmp/remove-ephemeral-codemod.py [--dry-run]

KEEP list: (relative path, 1-based line number) of each `ephemeral: true`
occurrence to PRESERVE, in the pre-codemod tree. Line numbers were taken
from `grep -n "ephemeral: true"` on the 1.15.6 tree (after the help.js /
trivia.js hand edits, which already removed those two sites).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRY_RUN = "--dry-run" in sys.argv

# (file, line) -> reason. Keep-list is intentionally short: private data,
# or a per-click confirmation whose public form would spam the channel /
# spoil a game. Permission denials are NOT kept (no private data; the
# check still blocks, only the reply's visibility changes).
KEEP = {
    # --- Privacy: birthdays (DOB) ---
    ("src/commands/birthdays/birthday.js", 28): "invalid-date error echoes the DOB the user typed",
    ("src/commands/birthdays/birthday.js", 34): "set confirmation shows the user's DOB incl. birth year",
    # --- Privacy: verification flows ---
    ("src/commands/verification/verify.js", 11): "verification flow",
    ("src/commands/verification/verify.js", 14): "verification flow",
    ("src/commands/verification/verify.js", 18): "verification flow (reveals verified status)",
    ("src/commands/verification/verify.js", 24): "verification flow (carries the Verify button)",
    ("src/commands/verification/verify-setup.js", 32): "verification setup flow",
    ("src/commands/verification/verify-setup.js", 43): "verification setup flow",
    ("src/commands/verification/verify-toggle.js", 16): "verification setup flow",
    ("src/commands/verification/verify-toggle.js", 18): "verification setup flow",
    ("src/events/verificationInteraction.js", 17): "verification flow",
    ("src/events/verificationInteraction.js", 21): "verification flow (reveals verified status)",
    ("src/events/verificationInteraction.js", 27): "verification flow",
    ("src/events/verificationInteraction.js", 28): "verification flow (role grant)",
    ("src/utils/verification.js", 92): "captcha flow (challenge expired)",
    ("src/utils/verification.js", 98): "captcha flow (reveals the correct answer)",
    ("src/utils/verification.js", 101): "verification flow",
    ("src/utils/verification.js", 102): "verification flow (role grant)",
    # --- Privacy: modmail (private user<->staff channel) ---
    ("src/commands/modmail/modmail-close.js", 13): "modmail staff flow",
    ("src/commands/modmail/modmail-close.js", 16): "modmail staff flow",
    ("src/commands/modmail/modmail-close.js", 18): "modmail staff flow",
    ("src/commands/modmail/modmail-setup.js", 20): "modmail staff flow",
    ("src/commands/modmail/modmail-setup.js", 24): "modmail staff flow",
    ("src/commands/modmail/modmail-block.js", 13): "modmail staff flow",
    ("src/commands/modmail/modmail-block.js", 19): "modmail staff flow (names blocked user)",
    # --- Privacy: reports (reporter confidentiality) ---
    ("src/commands/moderation/report.js", 37): "open-reports list (reporter/reported details)",
    ("src/commands/moderation/report.js", 63): "report-filed confirmation (names reporter + reported)",
    ("src/commands/moderation/report.js", 68): "report-filed confirmation (names reporter + reported)",
    ("src/commands/moderation/report.js", 73): "report-filed confirmation (names reporter + reported)",
    # --- Privacy: personal lists / reminders ---
    ("src/commands/utility/bookmark.js", 28): "user's own bookmarks list (may link channels others can't see)",
    ("src/commands/utility/bookmark.js", 30): "user's own bookmarks list",
    ("src/commands/utility/remind.js", 31): "reminder-set confirmation echoes the user's reminder text",
    ("src/commands/utility/remind.js", 40): "user's own reminders list (reminder text is personal)",
    ("src/commands/utility/remind.js", 44): "user's own reminders list",
    # --- Privacy: applications / confessions / ratings ---
    ("src/events/applicationInteraction.js", 48): "apply-submit defer (applying is private; confirmation would announce it)",
    ("src/events/confessionInteraction.js", 17): "confession submit failure (anonymity)",
    ("src/events/confessionInteraction.js", 23): "confession submitted (anonymity — public reply would link author)",
    ("src/events/confessionInteraction.js", 32): "confession review denial (staff-only flow)",
    ("src/events/confessionInteraction.js", 36): "confession review (staff-only flow)",
    ("src/events/confessionInteraction.js", 37): "confession review (staff-only flow)",
    ("src/events/confessionInteraction.js", 44): "confession review (staff-only flow)",
    ("src/events/ticketRatingInteraction.js", 23): "private ticket rating + carries the user's comment component",
    ("src/events/ticketRatingInteraction.js", 32): "private ticket-rating comment confirmation",
    # --- Privacy: owner-only output (may echo config / paths / eval results) ---
    ("src/commands/owner/eval.js", 17): "owner eval defer (output may contain anything incl. config)",
    ("src/commands/owner/backup.js", 9): "owner-only denial",
    ("src/commands/owner/backup.js", 10): "owner backup defer (output lists files/paths)",
    ("src/commands/owner/reload.js", 16): "owner reload (shows file paths)",
    ("src/commands/owner/reload.js", 26): "owner reload (shows file paths)",
    ("src/commands/owner/reload.js", 32): "owner reload (shows file path)",
    ("src/commands/owner/reload.js", 34): "owner reload (shows error details)",
    ("src/commands/owner/restart.js", 9): "owner restart confirmation",
    ("src/commands/owner/shutdown.js", 9): "owner shutdown confirmation",
    ("src/commands/owner/presence.js", 31): "owner presence config",
    ("src/commands/owner/presence.js", 35): "owner presence config",
    ("src/commands/owner/presence.js", 45): "owner presence config",
    # --- Anti-spam / game integrity: per-click confirmations ---
    ("src/events/giveawayInteraction.js", 41): "requirements failure names the member's private standing",
    ("src/events/giveawayInteraction.js", 45): "per-entrant confirmation (public = one message per entry)",
    ("src/events/giveawayInteraction.js", 51): "per-entrant confirmation incl. bonus details",
    ("src/events/reactionRoleInteraction.js", 58): "per-toggle confirmation (public = one message per click)",
    ("src/events/reactionRoleInteraction.js", 64): "requirements failure names the member's private standing",
    ("src/events/reactionRoleInteraction.js", 68): "per-toggle confirmation (public = one message per click)",
    ("src/events/roleMenuInteraction.js", 21): "per-toggle confirmation (public = one message per click)",
    ("src/events/roleMenuInteraction.js", 27): "requirements failure names the member's private standing",
    ("src/events/roleMenuInteraction.js", 31): "per-toggle confirmation (public = one message per click)",
    ("src/events/eventRsvpInteraction.js", 18): "per-RSVP confirmation (public = one message per RSVP)",
    ("src/events/heistInteraction.js", 14): "per-join confirmation incl. bet amount",
    ("src/events/suggestionInteraction.js", 47): "per-vote confirmation (public = one message per vote; reveals voter)",
    ("src/events/wordleInteraction.js", 18): "guess result (public = spam + spoils the daily word)",
    ("src/events/wordleInteraction.js", 24): "win result (public = spam + spoils the daily word)",
    ("src/events/wordleInteraction.js", 27): "lose result (public = spam + reveals the word)",
    ("src/events/wordleInteraction.js", 29): "guess result board (public = spam + spoils the daily word)",
    ("src/events/dailyTriviaInteraction.js", 13): "answer result (public = spam + spoils the daily question)",
    ("src/events/dailyTriviaInteraction.js", 14): "answer result (public = spam + spoils the daily question)",
    ("src/events/dailyTriviaInteraction.js", 15): "answer result (public = spam + spoils the daily question)",
}

PROP = re.compile(r"ephemeral\s*:\s*true")
DEFER_BARE = re.compile(r"deferReply\(\s*\{\s*ephemeral\s*:\s*true\s*\}\s*\)")


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def removal_span(text, start, end):
    """Return (span_start, span_end) to delete for one `ephemeral: true`
    match, taking exactly one adjacent comma with it, or None if the
    property is the only one in its object (caller handles that case)."""
    i = start - 1
    while i >= 0 and text[i] in " \t\r\n":
        i -= 1
    if i >= 0 and text[i] == ",":
        return (i, end)  # delete ", <ws> ephemeral: true"
    j = end
    while j < len(text) and text[j] in " \t\r\n":
        j += 1
    if j < len(text) and text[j] == ",":
        return (start, j + 1)  # delete "ephemeral: true,"
    return None


def process_file(path):
    """Returns (new_text, removed, kept_list, unhandled_list)."""
    rel = str(path.relative_to(ROOT))
    text = path.read_text()
    original = text
    removed = 0
    kept = []
    unhandled = []
    edits = []  # (span_start, span_end, replacement)
    kept_bare_spans = []  # spans of kept bare deferReply calls (pass 2 must skip them)

    # Pass 1: bare `deferReply({ ephemeral: true })` -> `deferReply()`.
    # (A bare `{ ephemeral: true }` on reply/followUp would be an empty
    # reply — none exist; pass 2 flags any it finds.)
    for m in DEFER_BARE.finditer(original):
        ln = line_of(original, m.start())
        if (rel, ln) in KEEP:
            kept.append((rel, ln, KEEP[(rel, ln)]))
            kept_bare_spans.append((m.start(), m.end()))
            continue
        edits.append((m.start(), m.end(), "deferReply()"))
        removed += 1

    # Pass 2: every other `ephemeral: true`. Positions are computed on the
    # ORIGINAL text; edits are applied bottom-up at the end, and pass-1
    # edits never remove a newline, so line numbers stay valid.
    for m in PROP.finditer(original):
        # Skip matches already covered by a pass-1 edit or a kept bare
        # deferReply span (the property sits inside that span).
        if any(s <= m.start() < e for s, e, _ in edits):
            continue
        if any(s <= m.start() < e for s, e in kept_bare_spans):
            continue
        ln = line_of(original, m.start())
        if (rel, ln) in KEEP:
            kept.append((rel, ln, KEEP[(rel, ln)]))
            continue
        span = removal_span(original, m.start(), m.end())
        if span is None:
            unhandled.append((rel, ln, original[max(0, m.start() - 60): m.end() + 60]))
            continue
        edits.append((span[0], span[1], ""))
        removed += 1

    # Apply all edits bottom-up so earlier positions stay valid.
    for s, e, rep in sorted(edits, reverse=True):
        text = text[:s] + rep + text[e:]
    return text, original, removed, kept, unhandled


def main():
    files = sorted(ROOT.joinpath("src").rglob("*.js"))
    total_matches = 0
    removed_total = 0
    kept_all = []
    unhandled_all = []
    changed_files = 0

    for path in files:
        rel = str(path.relative_to(ROOT))
        # Count matches on the pre-codemod text for reconciliation.
        before = path.read_text()
        total_matches += len(PROP.findall(before))
        text, original, removed, kept, unhandled = process_file(path)
        removed_total += removed
        kept_all.extend(kept)
        unhandled_all.extend(unhandled)
        if text != original:
            changed_files += 1
            if not DRY_RUN:
                path.write_text(text)

    print(f"files scanned: {len(files)}")
    print(f"ephemeral: true matches found: {total_matches}")
    print(f"removed: {removed_total}")
    print(f"kept: {len(kept_all)} (KEEP list has {len(KEEP)} entries)")
    print(f"files changed: {changed_files}")
    if kept_all:
        print("--- kept sites ---")
        for rel, ln, reason in sorted(kept_all):
            print(f"  KEEP {rel}:{ln} — {reason}")
    if unhandled_all:
        print("--- UNHANDLED (needs manual fix) ---")
        for rel, ln, ctx in unhandled_all:
            print(f"  {rel}:{ln}: ...{ctx!r}...")
        sys.exit(2)
    seen_keep = {(rel, ln) for rel, ln, _ in kept_all}
    missing = set(KEEP) - seen_keep
    if missing:
        print("--- KEEP entries NOT FOUND (line numbers may have shifted) ---")
        for rel, ln in sorted(missing):
            print(f"  MISSING {rel}:{ln} — {KEEP[(rel, ln)]}")
        sys.exit(3)
    # Every match must be accounted for: removed + kept == total.
    if removed_total + len(kept_all) != total_matches:
        print(f"RECONCILIATION FAILED: removed({removed_total}) + kept({len(kept_all)}) != total({total_matches})")
        sys.exit(4)
    print("OK" + (" (dry run — no files written)" if DRY_RUN else ""))


if __name__ == "__main__":
    main()
