// AI chat / Q&A (1.4.1): OpenAI-compatible chat completions.
// The owner supplies their own API key in config.json (ai.apiKey) — without
// one the feature is disabled with a clear message. No key is hardcoded and
// no free scraped endpoint is used. Per-channel history is in-memory only
// (last 10 messages) and never stored in the DB; usage counts go to ai_usage.
const config = require('./config');
const db = require('./database');

const RATE_LIMIT_MS = 10_000;
const MAX_TOKENS = 500;
const HISTORY_LIMIT = 10;

const lastRequestByUser = new Map(); // userId -> timestamp
const historyByChannel = new Map(); // channelId -> [{ role, content }]

function isAiConfigured() {
  const key = config.ai?.apiKey;
  return Boolean(key && !String(key).includes('YOUR_') && !String(key).includes('PLACEHOLDER'));
}

function aiModel() {
  return config.ai?.model || 'gpt-4o-mini';
}

function aiBaseUrl() {
  return (config.ai?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
}

function dailyLimit() {
  return config.ai?.dailyLimit ?? 100;
}

async function getDailyUsage(guildId) {
  if (!db.isEnabled()) return { count: 0, tokens: 0 };
  const rows = await db.query(
    'SELECT COUNT(*) AS c, COALESCE(SUM(tokens), 0) AS t FROM ai_usage WHERE guild_id = ? AND DATE(created_at) = CURDATE()',
    [guildId],
  ) || [];
  return { count: rows[0]?.c || 0, tokens: rows[0]?.t || 0 };
}

async function logUsage(guildId, userId, tokens) {
  if (!db.isEnabled()) return;
  await db.query('INSERT INTO ai_usage (guild_id, user_id, tokens) VALUES (?, ?, ?)', [guildId, userId, tokens]).catch(() => {});
}

function getHistory(channelId) {
  return historyByChannel.get(channelId) || [];
}

function pushHistory(channelId, role, content) {
  const hist = getHistory(channelId);
  hist.push({ role, content });
  while (hist.length > HISTORY_LIMIT) hist.shift();
  historyByChannel.set(channelId, hist);
}

// Returns { ok, reply } or { ok: false, error }.
async function askAI({ guildId, guildName, userId, channelId, question }) {
  if (!isAiConfigured()) {
    return { ok: false, error: 'AI chat is not set up — the server owner needs to add an OpenAI API key in config.json (ai.apiKey). Any OpenAI-compatible endpoint works; see README.' };
  }
  const now = Date.now();
  const last = lastRequestByUser.get(userId) || 0;
  if (now - last < RATE_LIMIT_MS) {
    return { ok: false, error: `Slow down — one AI question per ${RATE_LIMIT_MS / 1000} seconds. Try again in a moment.` };
  }
  const usage = await getDailyUsage(guildId);
  if (usage.count >= dailyLimit()) {
    return { ok: false, error: `This server's daily AI limit (${dailyLimit()} questions) has been reached. Try again tomorrow.` };
  }
  lastRequestByUser.set(userId, now);
  const history = getHistory(channelId);
  const messages = [
    { role: 'system', content: `You are Vikings Hall Clerk, a friendly Discord bot in the server "${guildName || 'this server'}". Answer concisely and helpfully. Keep answers short unless the question needs detail.` },
    ...history,
    { role: 'user', content: question },
  ];
  let res;
  try {
    res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
      body: JSON.stringify({ model: aiModel(), messages, max_tokens: MAX_TOKENS, temperature: 0.7 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach the AI provider: ${err.message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `The AI provider returned an error (${res.status}). ${res.status === 401 ? 'Check the API key in config.json.' : text.slice(0, 200)}` };
  }
  const json = await res.json().catch(() => null);
  const reply = json?.choices?.[0]?.message?.content?.trim();
  if (!reply) return { ok: false, error: 'The AI provider returned an empty reply.' };
  const tokens = json?.usage?.total_tokens || 0;
  await logUsage(guildId, userId, tokens);
  pushHistory(channelId, 'user', question);
  pushHistory(channelId, 'assistant', reply);
  return { ok: true, reply: reply.slice(0, 4000) };
}

module.exports = { isAiConfigured, aiModel, dailyLimit, getDailyUsage, askAI, getHistory };
