// Automated responses (1.14.3): per-server phrase triggers that get an
// automatic reply. Different from custom commands (/custom-add), which
// only fire when a message IS (or starts with) a single trigger word —
// an autoresponder fires when a phrase appears ANYWHERE in a message.
// Each rule can be toggled on/off individually. handleMessage is called
// from messageCreate after Automod (a deleted message never gets a reply)
// and respects the shared "handled" marker, so a message gets at most one
// auto reply (custom command, FAQ, or autoresponder).
const db = require('./database');
const { isHandled, markHandled } = require('./messageHandled');

async function getRules(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM autoresponders WHERE guild_id = ? ORDER BY `trigger`', [guildId])) || [];
}

async function handleMessage(message) {
  if (!db.isEnabled() || message.author.bot || !message.guild) return false;
  const content = (message.content || '').trim();
  if (!content || content.startsWith('/') || content.startsWith('!')) return false;
  if (isHandled(message.id)) return false;
  const rules = await getRules(message.guild.id).catch(() => []);
  const lower = content.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const trigger = String(rule.trigger || '').toLowerCase();
    if (!trigger) continue;
    const hit = rule.match_type === 'exact'
      ? lower === trigger
      : lower.includes(trigger);
    if (!hit) continue;
    markHandled(message.id);
    await message.reply({ content: rule.response }).catch(() => {});
    await db.query('UPDATE autoresponders SET use_count = use_count + 1 WHERE id = ?', [rule.id]).catch(() => {});
    return true;
  }
  return false;
}

module.exports = { getRules, handleMessage };
