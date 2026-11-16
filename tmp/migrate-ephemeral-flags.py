#!/usr/bin/env python3
"""Codemod for 1.15.29: migrate `ephemeral: true` in interaction response
options to `flags: MessageFlags.Ephemeral`.

discord.js deprecated the `ephemeral` response option — passing it now logs
`(node) Warning: Supplying "ephemeral" for interaction response options is
deprecated. Utilize flags instead.` This script converts every site (the 74
remaining from the 1.15.7 keep-list) and adds MessageFlags to each file's
discord.js import. It changes ONLY the mechanism, not which replies are
ephemeral vs public.

Usage:
  python3 tmp/migrate-ephemeral-flags.py [--dry-run]

Safety: the script refuses to touch a file unless
  - it contains exactly one `require('discord.js')` destructure, and
  - every `ephemeral: true` in it sits inside an interaction.reply /
    deferReply / followUp / editReply call (checked by looking back for the
    nearest `interaction.` response call on the same or an enclosing line
    block — verified by hand before running, see tmp/verify-1.15.29.js).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRY_RUN = "--dry-run" in sys.argv

# `const { A, B } = require('discord.js');` — single- or multi-line destructure.
IMPORT_RE = re.compile(
    r"const \{([^}]*)\} = require\('discord\.js'\);", re.DOTALL
)


def migrate_file(path: Path) -> int:
    text = path.read_text()
    sites = len(re.findall(r"ephemeral: true", text))
    if sites == 0:
        return 0

    imports = list(IMPORT_RE.finditer(text))
    assert len(imports) == 1, f"{path}: expected 1 discord.js destructure, got {len(imports)}"
    m = imports[0]
    names = [n.strip() for n in m.group(1).replace("\n", " ").split(",") if n.strip()]
    assert "MessageFlags" not in names, f"{path}: MessageFlags already imported"
    new_import = "const { MessageFlags, " + ", ".join(names) + " } = require('discord.js');"
    text = text[: m.start()] + new_import + text[m.end():]

    text = text.replace("ephemeral: true", "flags: MessageFlags.Ephemeral")
    assert "ephemeral: true" not in text, f"{path}: replacement missed a site"
    assert text.count("flags: MessageFlags.Ephemeral") == sites, f"{path}: count mismatch"

    if not DRY_RUN:
        path.write_text(text)
    return sites


def main() -> None:
    files = sorted(ROOT.glob("src/**/*.js"), key=str)
    total_files = 0
    total_sites = 0
    for path in files:
        if "ephemeral: true" not in path.read_text():
            continue
        n = migrate_file(path)
        total_files += 1
        total_sites += n
        print(f"  {path.relative_to(ROOT)}: {n} site(s)")
    print(f"{'Would migrate' if DRY_RUN else 'Migrated'} {total_sites} site(s) in {total_files} file(s)")


if __name__ == "__main__":
    main()
