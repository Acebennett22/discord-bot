// Auto-translate — detects the language of messages in watched channels
// and replies with a translation into the server's target language.
//
// Translation uses Google's free unofficial translate endpoint
// (translate.googleapis.com/translate_a/single, client=gtx). It needs no
// API key, but it is unofficial, has no SLA, and may rate-limit — failures
// are swallowed and logged, never fatal. Language detection is a small
// built-in heuristic (script + common-word matching) so no extra dependency
// is needed; it is good enough for common languages and degrades gracefully.
const db = require('./database');
const errorLogger = require('./errorLogger');

const SUPPORTED = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', uk: 'Ukrainian', id: 'Indonesian', vi: 'Vietnamese',
  th: 'Thai', he: 'Hebrew',
};
const FLAG = {
  en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', pt: '🇵🇹', nl: '🇳🇱',
  ru: '🇷🇺', ja: '🇯🇵', ko: '🇰🇷', zh: '🇨🇳', ar: '🇸🇦', hi: '🇮🇳', tr: '🇹🇷',
  pl: '🇵🇱', sv: '🇸🇪', uk: '🇺🇦', id: '🇮🇩', vi: '🇻🇳', th: '🇹🇭', he: '🇮🇱',
};

// Tiny word-list detector: script first, then common words.
const WORDS = {
  es: [' el ', ' la ', ' que ', ' de ', ' en ', ' los ', ' una ', ' por ', ' con ', ' hola ', ' gracias '],
  fr: [' le ', ' la ', ' les ', ' des ', ' est ', ' une ', ' dans ', ' pour ', ' bonjour ', ' merci '],
  de: [' der ', ' die ', ' und ', ' ist ', ' ich ', ' ein ', ' von ', ' mit ', ' nicht ', ' danke '],
  it: [' il ', ' che ', ' di ', ' non ', ' una ', ' per ', ' sono ', ' grazie ', ' ciao '],
  pt: [' o ', ' a ', ' de ', ' que ', ' em ', ' um ', ' para ', ' com ', ' obrigado ', ' olá '],
  nl: [' de ', ' het ', ' een ', ' ik ', ' van ', ' niet ', ' dank ', ' hallo '],
  ru: [' и ', ' в ', ' не ', ' на ', ' я ', ' что ', ' это ', ' спасибо '],
  uk: [' і ', ' в ', ' не ', ' на ', ' що ', ' дякую '],
  pl: [' i ', ' nie ', ' to ', ' się ', ' jak ', ' dziękuję ', ' cześć '],
  tr: [' ve ', ' bir ', ' bu ', ' için ', ' çok ', ' teşekkür ', ' merhaba '],
  sv: [' och ', ' det ', ' att ', ' jag ', ' inte ', ' tack ', ' hej '],
  id: [' dan ', ' yang ', ' saya ', ' tidak ', ' terima kasih ', ' halo '],
  vi: [' và ', ' của ', ' tôi ', ' không ', ' cảm ơn ', ' xin chào '],
};

function detectLanguage(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7a3]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u0400-\u04ff]/.test(text)) return /дякую|що|і\b/.test(text.toLowerCase()) ? 'uk' : 'ru';
  if (/[\u0590-\u05ff]/.test(text)) return 'he';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
  const padded = ` ${text.toLowerCase()} `;
  let best = null; let bestScore = 0;
  for (const [lang, words] of Object.entries(WORDS)) {
    const score = words.filter((w) => padded.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  if (best && bestScore >= 2) return best;
  // Default: assume English (the common case) — never translate English to English.
  return 'en';
}

async function translateText(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AceBot/1.10 (Discord bot)' } });
  if (!res.ok) throw new Error(`Translate endpoint returned ${res.status}`);
  const data = await res.json();
  const translated = (data?.[0] || []).map((part) => part?.[0] || '').join('');
  const detected = data?.[2] || null;
  if (!translated) throw new Error('Empty translation result');
  return { translated, detected };
}

// Normalize channels_json to an array of string channel IDs. The column is
// MySQL JSON, so mysql2 already parses it — a correct row arrives as a JS
// array, and the old `JSON.parse(r.channels_json)` coerced that array to
// "123,456", threw, and silently fell back to [] (auto-translate never
// matched). A bare stored value (single ID as a JSON number/string) came
// back as a number, so `settings.channels.includes` threw at runtime.
// Tolerate every shape: parsed array, JSON string, bare number/string,
// object, null/invalid.
function normalizeChannels(value) {
  let list = value;
  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) return [];
    // Only JSON-parse array/object/quoted-string shapes. A bare numeric
    // string must NOT be parsed — JSON.parse would turn it into a number
    // and lose precision past 2^53, corrupting the channel ID.
    const first = trimmed[0];
    if (first === '[' || first === '{' || first === '"') {
      try {
        list = JSON.parse(trimmed);
      } catch {
        // Not JSON — treat it as a comma-separated list of IDs.
        return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else {
      return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (Array.isArray(list)) return list.map((v) => String(v)).filter(Boolean);
  if (list && typeof list === 'object') return Object.values(list).map((v) => String(v)).filter(Boolean);
  if (list === null || list === undefined) return [];
  return [String(list)];
}

async function getTranslateSettings(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM translate_settings WHERE guild_id = ?', [guildId]);
  if (!rows?.length) return { enabled: false, channels: [], target_lang: 'en' };
  const r = rows[0];
  return { enabled: r.enabled === 1, channels: normalizeChannels(r.channels_json), target_lang: r.target_lang || 'en' };
}

async function saveTranslateSettings(guildId, patch) {
  if (!db.isEnabled()) return false;
  const cur = await getTranslateSettings(guildId);
  const next = {
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
    channels: patch.channels !== undefined ? normalizeChannels(patch.channels) : normalizeChannels(cur.channels),
    target_lang: patch.targetLang || cur.target_lang || 'en',
  };
  await db.query(
    `INSERT INTO translate_settings (guild_id, enabled, channels_json, target_lang) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), channels_json = VALUES(channels_json), target_lang = VALUES(target_lang)`,
    [guildId, next.enabled, JSON.stringify(next.channels), next.target_lang],
  );
  return true;
}

// Auto-translate hook for messageCreate: returns true if it replied.
async function handleTranslateMessage(message) {
  try {
    const settings = await getTranslateSettings(message.guildId);
    if (!settings.enabled || !settings.channels.includes(message.channelId)) return false;
    const text = (message.content || '').trim();
    if (!text || text.length < 4 || text.length > 1000) return false;
    if (/^[/!]/.test(text)) return false; // commands, not chat
    const detected = detectLanguage(text);
    if (detected === settings.target_lang) return false;
    const { translated } = await translateText(text, settings.target_lang);
    if (translated.trim().toLowerCase() === text.toLowerCase()) return false;
    const { infoEmbed } = require('./embeds');
    await message.reply({
      embeds: [infoEmbed('🌐 Auto-translate',
        `${FLAG[detected] || ''} **Original (${SUPPORTED[detected] || detected}):** ${text.length > 900 ? text.slice(0, 900) + '…' : text}\n\n${FLAG[settings.target_lang] || ''} **${SUPPORTED[settings.target_lang] || settings.target_lang}:** ${translated.length > 900 ? translated.slice(0, 900) + '…' : translated}`)],
    }).catch(() => {});
    return true;
  } catch (e) {
    errorLogger.log({ level: 'error', guildId: message.guildId, commandName: 'translate', message: `Auto-translate failed: ${e.message}`, stack: e.stack });
    return false;
  }
}

module.exports = { SUPPORTED, FLAG, detectLanguage, translateText, normalizeChannels, getTranslateSettings, saveTranslateSettings, handleTranslateMessage };
