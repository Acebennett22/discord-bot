// Embed builder for the dashboard Embed Creator (1.15.26).
// Pure validation + payload building — no Discord calls here, so the
// dashboard route and the verify script share exactly one source of truth
// for the limits. Discord's own limits: title 256, description 4096,
// field name 256, field value 1024, max 25 fields, total 6000 chars
// across title + description + field names/values + footer text +
// author name, message content 2000.
const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  total: 6000,
};

const DEFAULT_COLOR = 0x5865f2;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseColor(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_COLOR;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  const s = String(v).trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  if (m) return parseInt(m[1], 16);
  throw new Error('Color must be a hex color like #5865F2.');
}

// Validates the creator form input and returns the exact payload the
// dashboard routes POST to Discord: { content, embeds: [embed] }.
// (1.15.31: this was { content, embed } — Discord's create-message
// endpoint only accepts `embeds` (array) and silently drops a singular
// `embed`, so 1.15.26's sends posted the plain content with no embed
// attached, or failed outright on an empty message. The routes post
// this object as-is, so the shape here IS the wire shape.)
// Throws an Error with a human-readable message on the first problem.
function buildEmbed(input) {
  const data = input && typeof input === 'object' ? input : {};
  const content = str(data.content);
  const title = str(data.title);
  const description = str(data.description);
  const authorName = str(data.authorName);
  const authorIcon = str(data.authorIcon);
  const footerText = str(data.footerText);
  const footerIcon = str(data.footerIcon);
  const thumbnail = str(data.thumbnail);
  const image = str(data.image);

  if (content.length > LIMITS.content) throw new Error(`Message content is ${content.length} characters — Discord allows at most ${LIMITS.content}.`);
  if (title.length > LIMITS.title) throw new Error(`Title is ${title.length} characters — Discord allows at most ${LIMITS.title}.`);
  if (description.length > LIMITS.description) throw new Error(`Description is ${description.length} characters — Discord allows at most ${LIMITS.description}.`);
  if (authorName.length > LIMITS.title) throw new Error(`Author name is ${authorName.length} characters — Discord allows at most ${LIMITS.title}.`);
  if (footerText.length > 2048) throw new Error(`Footer text is ${footerText.length} characters — Discord allows at most 2048.`);

  for (const [label, url] of [['Author icon', authorIcon], ['Footer icon', footerIcon], ['Thumbnail', thumbnail], ['Image', image]]) {
    if (url && !isHttpUrl(url)) throw new Error(`${label} must be a full http(s) URL.`);
  }

  const rawFields = Array.isArray(data.fields) ? data.fields : [];
  if (rawFields.length > LIMITS.fields) throw new Error(`Too many fields (${rawFields.length}) — Discord allows at most ${LIMITS.fields}.`);
  const fields = [];
  rawFields.forEach((f, i) => {
    const name = str(f && f.name);
    const value = str(f && f.value);
    if (!name && !value) return; // blank row = ignored
    if (!name) throw new Error(`Field ${i + 1} needs a name.`);
    if (!value) throw new Error(`Field ${i + 1} needs a value.`);
    if (name.length > LIMITS.fieldName) throw new Error(`Field ${i + 1} name is ${name.length} characters — Discord allows at most ${LIMITS.fieldName}.`);
    if (value.length > LIMITS.fieldValue) throw new Error(`Field ${i + 1} value is ${value.length} characters — Discord allows at most ${LIMITS.fieldValue}.`);
    fields.push({ name, value, inline: Boolean(f && f.inline) });
  });

  // Discord's 6000-character total across the embed's text parts.
  const total = title.length + description.length + authorName.length + footerText.length
    + fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  if (total > LIMITS.total) throw new Error(`Embed is ${total} characters in total — Discord allows at most ${LIMITS.total}.`);

  const embed = { color: parseColor(data.color) };
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (authorName) embed.author = { name: authorName, ...(authorIcon ? { icon_url: authorIcon } : {}) };
  if (footerText) embed.footer = { text: footerText, ...(footerIcon ? { icon_url: footerIcon } : {}) };
  if (thumbnail) embed.thumbnail = { url: thumbnail };
  if (image) embed.image = { url: image };
  if (fields.length) embed.fields = fields;

  // Discord rejects a message with neither content nor any embed text.
  if (!content && !title && !description && !fields.length && !authorName && !footerText) {
    throw new Error('Nothing to send — add message content, a title, a description, or at least one field.');
  }

  return { content: content || undefined, embeds: [embed] };
}

module.exports = { buildEmbed, LIMITS, DEFAULT_COLOR };
