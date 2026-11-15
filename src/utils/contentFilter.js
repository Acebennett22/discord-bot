// Content filter (1.14.5): per-entry blocked words AND harmful-link
// domains, each with its own action and severity level. This merges the
// old flat banned-words list's job into something finer: a slur can be
// delete + timeout at high severity while a mild word is delete-only,
// and a scam domain can be blocked even when plain links are allowed.
// No default word list ships with the bot — every server defines its own
// entries (a hardcoded slur list in the repo would be wrong for every
// community). Enforcement runs inside automod.handleMessage, after the
// spam detectors and before the legacy banned-words check.
const db = require('./database');

const ACTIONS = ['delete', 'warn', 'timeout', 'delete_warn', 'delete_timeout'];
const SEVERITIES = ['low', 'medium', 'high'];

async function getRules(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM content_filter_rules WHERE guild_id = ? ORDER BY type, severity, value', [guildId])) || [];
}

// Word-boundary match, same as the legacy banned-words check, so "class"
// doesn't trip on "ass".
function wordHit(content, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(content || ''));
}

// Domain hit: any http(s) link in the message whose hostname is the
// blocked domain or a subdomain of it.
function domainHit(content, value) {
  const domain = String(value).trim().toLowerCase();
  const urls = String(content || '').match(/https?:\/\/[^\s/]+/gi) || [];
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`)) return host;
    } catch {}
  }
  return null;
}

// First matching rule, words checked before domains. Returns
// { rule, matched } or null.
function findHit(content, rules) {
  for (const rule of rules) {
    if (rule.type === 'word' && wordHit(content, rule.value)) return { rule, matched: rule.value };
  }
  for (const rule of rules) {
    if (rule.type === 'domain') {
      const host = domainHit(content, rule.value);
      if (host) return { rule, matched: host };
    }
  }
  return null;
}

module.exports = { ACTIONS, SEVERITIES, getRules, wordHit, domainHit, findHit };
