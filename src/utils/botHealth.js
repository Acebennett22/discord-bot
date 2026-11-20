// Dashboard-side fetch of the bot's localhost health endpoint (1.16.5).
// Server-side only — the browser never touches it. Returns the parsed
// /health JSON, or null when the bot is unreachable, slow, or answers
// garbage. Never throws and never hangs: a dead bot means the staff page
// still renders fast with "not connected", exactly as before.
async function fetchBotHealth(port, { timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object' || !Array.isArray(json.shards)) return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchBotHealth };
