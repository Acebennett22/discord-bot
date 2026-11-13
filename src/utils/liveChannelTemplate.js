// Per-server live-channel name template, stored in MySQL guild_settings
// (live_channel_name_template). config.json streams.liveChannelNameTemplate
// is only the global fallback default.
const config = require('./config');
const { getGuildSettings, setGuildSettings } = require('./guildSettings');

const DEFAULT_TEMPLATE = '🔴 LIVE: {name}';
const MAX_LEN = 100;

function validateTemplate(template) {
  if (typeof template !== 'string') return 'Template must be text.';
  if (template.includes('\n') || template.includes('\r')) return 'Template must be a single line (no newlines).';
  if (template.length === 0 || template.length > MAX_LEN) return `Template must be 1–${MAX_LEN} characters.`;
  if (!template.includes('{name}')) return 'Template must contain {name} so the channel always names the streamer.';
  return null; // valid
}

function renderTemplate(template, { name, game = '', title = '' } = {}) {
  const tpl = template && validateTemplate(template) === null ? template : DEFAULT_TEMPLATE;
  return tpl.replaceAll('{name}', name).replaceAll('{game}', game || '').replaceAll('{title}', title || '');
}

async function getTemplate(guildId) {
  const fallback = config.streams?.liveChannelNameTemplate || DEFAULT_TEMPLATE;
  if (!guildId) return fallback;
  const settings = await getGuildSettings(guildId);
  const tpl = settings.liveChannelNameTemplate;
  return tpl && validateTemplate(tpl) === null ? tpl : fallback;
}

async function setTemplate(guildId, template) {
  const err = validateTemplate(template);
  if (err) return { ok: false, error: err };
  await setGuildSettings(guildId, { liveChannelNameTemplate: template });
  return { ok: true };
}

module.exports = { DEFAULT_TEMPLATE, MAX_LEN, validateTemplate, renderTemplate, getTemplate, setTemplate };
