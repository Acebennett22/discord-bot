// Reaction roles — button-based (preferred). Classic reactions are NOT used:
// buttons are reliable, don't need the GuildMessageReactions intent, and
// can't be spoofed by reacting to the wrong message.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');

function emojiLabel(emoji) {
  // Custom emoji <:name:id> -> show name; unicode -> itself.
  const m = /^<a?:(\w+):\d+>$/.exec(emoji);
  return m ? m[1] : emoji;
}

function emojiButton(emoji, roleId, roleName) {
  // 1.15.36: the label is the ROLE NAME (truncated to Discord's 80-char
  // button-label limit), with the emoji rendered beside it via setEmoji —
  // so a button reads "💻 PC Warrior". Falls back to the role ID when the
  // name could not be resolved, so a refresh never fails over a name.
  const label = String(roleName || roleId).slice(0, 80);
  const btn = new ButtonBuilder().setCustomId(`rr:${roleId}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  // Custom emoji need the raw <...:...> form; unicode emoji go in directly.
  if (/^<a?:\w+:\d+>$/.test(emoji)) {
    const [,, id] = emoji.replace(/[<>]/g, '').split(':');
    btn.setEmoji(id);
  } else {
    btn.setEmoji(emoji);
  }
  return btn;
}

async function getMappings(messageId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM reaction_roles WHERE message_id = ?', [messageId])) || [];
}

// True when the reaction-role message is enabled (1.14.1). A message with
// no mappings at all counts as disabled — there is nothing to grant.
async function isMessageEnabled(messageId) {
  const mappings = await getMappings(messageId);
  if (!mappings.length) return false;
  return mappings.every((m) => m.enabled !== 0);
}

// Role-name resolvers (1.15.36): buildRows() labels buttons with role
// names, but only sees role IDs. Both factories return an async
// (roleId) => name | null; a null means "unresolvable" and the caller
// falls back to the role ID as the label — never throws.
function roleNameResolverFromGuild(guild) {
  let allPromise = null;
  return async (roleId) => {
    const cached = guild?.roles?.cache?.get(roleId);
    if (cached) return cached.name;
    if (!allPromise) allPromise = guild?.roles?.fetch().catch(() => null);
    const all = await allPromise;
    return all?.get(roleId)?.name || null;
  };
}
function roleNameResolverFromRest(discord, guildId) {
  let rolesPromise = null;
  return async (roleId) => {
    if (!rolesPromise) rolesPromise = discord.listGuildRoles(guildId).catch(() => []);
    const roles = (await rolesPromise) || [];
    return roles.find((r) => String(r.id) === String(roleId))?.name || null;
  };
}

async function buildRows(messageId, roleNameResolver) {
  const mappings = await getMappings(messageId);
  const enabled = mappings.length > 0 && mappings.every((m) => m.enabled !== 0);
  // Resolve each distinct role's name once, so every button can show it.
  // No resolver (or an unresolvable role) falls back to the role ID label.
  const names = new Map();
  if (roleNameResolver) {
    await Promise.all([...new Set(mappings.map((m) => m.role_id))].map(async (id) => {
      try { names.set(id, await roleNameResolver(id)); } catch { names.set(id, null); }
    }));
  }
  const rows = [];
  for (let i = 0; i < mappings.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...mappings.slice(i, i + 5).map((m) => {
        const btn = emojiButton(m.emoji, m.role_id, names.get(m.role_id) || null);
        if (!enabled) btn.setDisabled(true);
        return btn;
      }),
    ));
  }
  return rows;
}

// Dashboard add-mapping (1.15.32) — the dashboard has no bot client, so the
// route passes in a small `discord` adapter around its REST client.
// `botUserId` is the bot's own user id (config.clientId): reaction-role
// buttons can only be added to the bot's own messages, so a mapping on
// anyone else's message would be dead on arrival.
// Resolve the form's two emoji inputs into the one stored value. Custom
// wins when both are filled. Throws a user-facing Error when neither is
// usable.
function resolveEmojiInput(emojiCustom, emojiUnicode) {
  const custom = String(emojiCustom || '').trim();
  if (custom) {
    if (!/^<a?:\w+:\d+>$/.test(custom)) throw new Error('That custom emoji value looks invalid — pick one from the list.');
    return custom;
  }
  const unicode = String(emojiUnicode || '').trim();
  if (!unicode) throw new Error('Pick a custom emoji from the list or type a Unicode emoji.');
  if (/\s/.test(unicode)) throw new Error('Type a single Unicode emoji (no spaces).');
  const points = [...unicode];
  if (points.length > 4 || !points.some((ch) => ch.codePointAt(0) > 127)) {
    throw new Error('Type a single Unicode emoji.');
  }
  return unicode;
}

// A custom emoji must belong to this guild — the form only offers the
// guild's own, but the value comes from the client, so verify. Unicode
// passes through (Discord itself is the backstop at PATCH time).
function validateEmojiAgainstGuild(emoji, guildEmojis) {
  const m = /^<a?:\w+:(\d+)>$/.exec(emoji);
  if (!m) return;
  if (!(guildEmojis || []).some((e) => String(e.id) === m[1])) {
    throw new Error('That custom emoji is not in this server.');
  }
}

function fail(status, message) { const e = new Error(message); e.status = status; throw e; }

// Shared per-batch context (1.15.33): caches the guild emoji list and the
// message fetches, so a batch touching one message N times hits Discord
// once per message instead of once per row.
function batchContext(discord, guildId) {
  let emojisPromise = null;
  const messages = new Map();
  return {
    listGuildEmojis: () => (emojisPromise ||= discord.listGuildEmojis(guildId).catch(() => [])),
    getMessage: (channelId, messageId) => {
      const key = `${channelId}:${messageId}`;
      if (!messages.has(key)) messages.set(key, discord.getMessage(channelId, messageId).catch(() => null));
      return messages.get(key);
    },
  };
}

// Read-only checks shared by the single add and the bulk add. Throws a
// user-facing Error (with .status: 400 validation) when anything is wrong.
async function validateMappingForInsert({ guildId, channelId, messageId, emoji, botUserId }, ctx) {
  const guildEmojis = await ctx.listGuildEmojis();
  validateEmojiAgainstGuild(emoji, guildEmojis);
  const message = await ctx.getMessage(channelId, messageId);
  if (!message) fail(400, 'That message does not exist in this channel.');
  if (message.author?.id !== botUserId) fail(400, "That message wasn't posted by the bot — reaction roles can only be added to the bot's own messages.");
  // Duplicate check (1.15.37): scoped by guild + channel + message +
  // emoji — exactly the rows the list groups by (channel, message) and the
  // refresh count checks. The old check ignored channel_id, so it read a
  // different truth than the list: a row stored under the same message but
  // a different channel looked like a duplicate here while the list showed
  // it under another group (and the refresh count missed it). A row under
  // the same message with a wrong channel is NOT a duplicate at this
  // stage — the insert path repairs its channel instead (see
  // insertMappingRow); only an exact (channel, role) match is rejected.
  const existing = await db.query('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND emoji = ?', [guildId, channelId, messageId, emoji]);
  if (existing?.length) fail(400, 'That emoji is already mapped on this message.');
}

async function insertMappingRow({ guildId, channelId, messageId, emoji, roleId }) {
  // Verify the row actually persisted (1.15.37). db.query() swallows every
  // error and returns null, so the old code could never see an INSERT
  // failure — a bulk add reported "11 added" while only 2 rows were
  // stored, and its ER_DUP_ENTRY catch was dead code in production.
  // mysql2's execute returns an OkPacket for INSERTs and db.query() passes
  // it through, so affectedRows === 1 is the proof the row landed.
  let result;
  let threw = null;
  try {
    result = await db.query(
      'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)',
      [guildId, channelId, messageId, emoji, roleId],
    );
  } catch (err) {
    // db.query() never throws in production (it swallows); this only fires
    // for a stubbed db.query — fall through to the lookup below instead of
    // assuming the reason.
    threw = err;
  }
  if (result?.affectedRows === 1) return;
  // The insert did not land. Look up what is actually stored for this
  // (guild, message, emoji) — deliberately WITHOUT the channel filter, so
  // a row stored under the same message but a wrong channel is found
  // instead of reported as a mystery failure.
  const existing = await db.query(
    'SELECT channel_id, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?',
    [guildId, messageId, emoji],
  ).catch(() => null);
  if (!existing?.length) {
    if (threw && threw.code !== 'ER_DUP_ENTRY') throw threw;
    fail(500, `The mapping for ${emoji} could not be saved to the database — please try adding it again.`);
  }
  const ex = existing[0];
  if (ex.role_id !== roleId) fail(400, 'That emoji is already mapped on this message.');
  if (ex.channel_id !== channelId) {
    // Same message, emoji and role, but the stored channel is wrong (the
    // add form carries a channel per row, and the duplicate check is
    // scoped by channel) — repair the stored channel instead of blocking
    // the re-add with a duplicate error. A message lives in exactly one
    // channel, so this re-key is always correct.
    const repaired = await db.query(
      'UPDATE reaction_roles SET channel_id = ? WHERE guild_id = ? AND message_id = ? AND emoji = ?',
      [channelId, guildId, messageId, emoji],
    ).catch(() => null);
    if (repaired?.affectedRows === 1) return;
  }
  fail(400, 'That emoji is already mapped on this message.');
}

async function deleteMappingRow({ guildId, messageId, emoji }) {
  await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, messageId, emoji]).catch(() => {});
}

// Refresh one message's buttons through the same buildRows() the bot uses.
// `guildId` lets the dashboard's REST adapter resolve role names for the
// labels (1.15.36); without it (or without listGuildRoles on the adapter)
// buttons fall back to role-ID labels instead of failing.
async function refreshMessageButtons(channelId, messageId, discord, guildId) {
  const resolver = (guildId && discord?.listGuildRoles)
    ? roleNameResolverFromRest(discord, guildId)
    : null;
  const components = (await buildRows(messageId, resolver)).map((row) => row.toJSON());
  await discord.patchMessage(channelId, messageId, { components });
}

// Insert one mapping in the exact shape /reactionroles-add writes, then
// refresh the message's buttons through the same buildRows() the bot uses
// — so a dashboard-added mapping works and looks identical to a
// command-added one, with no bot restart (handlers read the DB per event).
// Throws a user-facing Error (with .status: 400 validation, 502 Discord).
async function addMapping({ guildId, channelId, messageId, emoji, roleId, botUserId }, discord) {
  const ctx = batchContext(discord, guildId);
  await validateMappingForInsert({ guildId, channelId, messageId, emoji, botUserId }, ctx);
  await insertMappingRow({ guildId, channelId, messageId, emoji, roleId });
  try {
    await refreshMessageButtons(channelId, messageId, discord, guildId);
  } catch (err) {
    // The buttons are the whole interface — a mapping without them is
    // useless, so roll the row back instead of leaving an orphan.
    await deleteMappingRow({ guildId, messageId, emoji });
    const detail = err.response?.data?.message || err.message || 'unknown error';
    fail(502, `Discord refused the button update (${detail}) — the mapping was not kept.`);
  }
  return { messageId, channelId };
}

// Bulk add (1.15.33). `rows` are already normalized ({channelId, messageId,
// emoji, roleId}) with the route-level checks (channel/role exist, emoji
// resolved) done. Every row is validated first, then the valid ones are
// inserted; each affected message's buttons are refreshed exactly once.
// Returns per-row results aligned with `rows`: { ok: true } or
// { ok: false, error }. A bad row never blocks the others, and a refused
// button refresh rolls back only this batch's rows on that message.
async function addMappingsBatch({ guildId, botUserId, rows }, discord) {
  const ctx = batchContext(discord, guildId);
  const results = rows.map(() => null);
  const seen = new Set();
  const valid = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = `${row.messageId}:${row.emoji}`;
    if (seen.has(key)) {
      results[i] = { ok: false, error: 'The same emoji is used twice for this message in this batch.' };
      continue;
    }
    seen.add(key);
    try {
      await validateMappingForInsert({ guildId, ...row, botUserId }, ctx);
      valid.push({ ...row, index: i });
    } catch (e) {
      results[i] = { ok: false, error: e.message };
    }
  }
  // Insert the valid rows. A race duplicate surfaces as ER_DUP_ENTRY here.
  const inserted = [];
  for (const row of valid) {
    try {
      await insertMappingRow({ guildId, ...row });
      inserted.push(row);
    } catch (e) {
      results[row.index] = { ok: false, error: e.message };
    }
  }
  // Refresh each affected message once, grouped by channel + message.
  const byMessage = new Map();
  for (const row of inserted) {
    const key = `${row.channelId}:${row.messageId}`;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(row);
  }
  for (const group of byMessage.values()) {
    const { channelId, messageId } = group[0];
    try {
      await refreshMessageButtons(channelId, messageId, discord, guildId);
    } catch (err) {
      for (const row of group) await deleteMappingRow({ guildId, messageId, emoji: row.emoji });
      const detail = err.response?.data?.message || err.message || 'unknown error';
      for (const row of group) results[row.index] = { ok: false, error: `Discord refused the button update (${detail}) — the mapping was not kept.` };
      continue;
    }
    // 1.15.37: the refresh built buttons from the DB — verify every row in
    // this group actually persisted before reporting it saved. The insert
    // check above should already guarantee it; this catches anything that
    // slipped through, so a batch can never again report "11 added" when
    // only 2 rows are stored. A row missing here is marked failed (the
    // good rows stay ok — nothing is rolled back over a mismatch). A null
    // read means the verification itself failed, which is reported as
    // unconfirmed rather than claimed either way.
    const readBack = await db.query(
      'SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?',
      [guildId, messageId],
    );
    if (readBack === null) {
      for (const row of group) results[row.index] = { ok: false, error: `The mapping for ${row.emoji} may have saved, but the result could not be confirmed — check the Reaction Roles list and try adding it again if it is missing.` };
      continue;
    }
    const persisted = new Set(readBack.map((r) => r.emoji));
    for (const row of group) {
      if (persisted.has(row.emoji)) results[row.index] = { ok: true };
      else results[row.index] = { ok: false, error: `The mapping for ${row.emoji} did not save to the database — please try adding it again.` };
    }
  }
  return results;
}

// Bulk remove (1.15.33). `rows` are mapping rows already fetched by the
// route ({channelId, messageId, emoji}). Deletes every row, then refreshes
// each affected message's buttons exactly once (grouped by message, same
// buildRows() path). Returns per-row results aligned with `rows`:
// { ok: true, messageGone } or { ok: false, error }. A message already gone
// from Discord (404 / Unknown Message) still counts as removed — the mapping
// is gone either way. Any other button-update failure leaves the row deleted
// but reports a warning (the stale button clears on the message's next
// refresh) instead of pretending the removal failed.
async function removeMappingsBatch({ guildId, rows }, discord) {
  // Rows arrive in either shape: the bulk-delete route passes raw mysql2
  // rows (snake_case: message_id, channel_id), while the single remove
  // normalizes to camelCase first. The helper used to read only camelCase,
  // so a raw row made the DELETE run with message_id = undefined — mysql2
  // threw, db.query() swallowed it, and the route reported success while
  // nothing was deleted (1.15.34). Normalize here, at the choke point, so
  // no caller can hit that mismatch again.
  const normalized = (rows || []).map((row) => ({
    id: row.id,
    channelId: row.channelId ?? row.channel_id,
    messageId: row.messageId ?? row.message_id,
    emoji: row.emoji,
  }));
  const results = normalized.map(() => null);
  const deleted = [];
  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, row.messageId, row.emoji]);
    deleted.push({ ...row, index: i });
  }
  const byMessage = new Map();
  for (const row of deleted) {
    const key = `${row.channelId}:${row.messageId}`;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(row);
  }
  for (const group of byMessage.values()) {
    const { channelId, messageId } = group[0];
    try {
      await refreshMessageButtons(channelId, messageId, discord, guildId);
      for (const row of group) results[row.index] = { ok: true, messageGone: false };
    } catch (err) {
      const status = err.response?.status;
      const code = err.response?.data?.code;
      if (status === 404 || code === 10008) {
        for (const row of group) results[row.index] = { ok: true, messageGone: true };
      } else {
        const detail = err.response?.data?.message || err.message || 'unknown error';
        for (const row of group) results[row.index] = { ok: true, messageGone: false, warning: `Button update failed (${detail}) — the button may linger until the message's buttons are next refreshed.` };
      }
    }
  }
  return results;
}

// Remove one mapping (1.15.33): delete the row, then refresh the message's
// buttons through the same buildRows() the bot uses, so the removed button
// disappears from the message. If the message itself is already gone from
// Discord (404 / Unknown Message), the delete still succeeds — the mapping
// is gone either way.
async function removeMapping({ guildId, channelId, messageId, emoji }, discord) {
  const [result] = await removeMappingsBatch({ guildId, rows: [{ channelId, messageId, emoji }] }, discord);
  return result;
}

module.exports = { emojiLabel, emojiButton, getMappings, isMessageEnabled, buildRows, resolveEmojiInput, validateEmojiAgainstGuild, addMapping, addMappingsBatch, removeMapping, removeMappingsBatch, refreshMessageButtons, roleNameResolverFromGuild, roleNameResolverFromRest };
