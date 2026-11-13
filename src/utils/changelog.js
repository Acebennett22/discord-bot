// Keep-a-Changelog parser for CHANGELOG.md — no new dependency.
// Parses `## [x.y.z] - YYYY-MM-DD` entries with `### Added/Changed/Fixed`
// (or any `### <Section>`) subsections of `- ` bullets. Anything before
// the first version heading is ignored. Malformed lines are skipped, never
// fatal — the /version page renders whatever parsed cleanly.
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', '..', 'CHANGELOG.md');

function parseChangelog(text) {
  const entries = [];
  let current = null;
  let section = null;
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    const versionMatch = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/.exec(line);
    if (versionMatch) {
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      entries.push(current);
      section = null;
      continue;
    }
    if (!current) continue;
    const sectionMatch = /^### (.+)$/.exec(line);
    if (sectionMatch) {
      section = { title: sectionMatch[1].trim(), items: [] };
      current.sections.push(section);
      continue;
    }
    if (line.startsWith('- ') && section) {
      section.items.push(line.slice(2).trim());
      continue;
    }
    // Continuation of the previous bullet (wrapped line).
    if (line && section?.items.length) {
      section.items[section.items.length - 1] += ` ${line}`;
    }
  }
  return entries;
}

function loadChangelog() {
  try {
    return parseChangelog(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}

module.exports = { parseChangelog, loadChangelog, CHANGELOG_PATH };
