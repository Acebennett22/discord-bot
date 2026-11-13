// Player-to-player trading. Offers are { coins, items: [{item_id, quantity}] }.
// executeTrade runs the whole swap inside ONE MySQL transaction
// (db.withTransaction): balances are guarded by the UPDATE itself
// (balance >= amount), inventory moves are checked first, and the trade
// row flips to completed only if every leg succeeds — a failed trade can
// never duplicate items or coins.
const db = require('./database');

function normalizeOffer(offer) {
  const o = offer || {};
  return {
    coins: Math.max(0, parseInt(o.coins, 10) || 0),
    items: Array.isArray(o.items) ? o.items.map((i) => ({ item_id: parseInt(i.item_id, 10), quantity: Math.max(0, parseInt(i.quantity, 10) || 0) })).filter((i) => i.item_id && i.quantity > 0) : [],
  };
}

function offerIsEmpty(offer) {
  const o = normalizeOffer(offer);
  return o.coins === 0 && o.items.length === 0;
}

async function describeOffer(guildId, offer) {
  const o = normalizeOffer(offer);
  const parts = [];
  if (o.coins > 0) parts.push(`🪙 ${o.coins} coins`);
  for (const item of o.items) {
    const rows = await db.query('SELECT name, emoji FROM shop_items WHERE guild_id = ? AND id = ?', [guildId, item.item_id]);
    const name = rows?.[0] ? `${rows[0].emoji ? `${rows[0].emoji} ` : ''}${rows[0].name}` : `item #${item.item_id}`;
    parts.push(`${name} x${item.quantity}`);
  }
  return parts.length ? parts.join(', ') : 'nothing';
}

// Re-validate inside the transaction that both sides still own what they
// offered, then swap. Returns { ok, error? }.
async function executeTrade(trade) {
  const proposerOffer = normalizeOffer(trade.proposer_offer);
  const partnerOffer = normalizeOffer(trade.partner_offer);
  const { guild_id: guildId, proposer_id: proposerId, partner_id: partnerId } = trade;

  const result = await db.withTransaction(async (q) => {
    // --- Validate proposer side ---
    if (proposerOffer.coins > 0) {
      const [r] = await q('SELECT balance FROM economy_users WHERE guild_id = ? AND user_id = ? FOR UPDATE', [guildId, proposerId]);
      if (!r || r.balance < proposerOffer.coins) return { ok: false, error: `<@${proposerId}> no longer has ${proposerOffer.coins} coins.` };
    }
    for (const item of proposerOffer.items) {
      const [r] = await q('SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ? FOR UPDATE', [guildId, proposerId, item.item_id]);
      if (!r || r.quantity < item.quantity) return { ok: false, error: `<@${proposerId}> no longer has ${item.quantity}x item #${item.item_id}.` };
    }
    // --- Validate partner side ---
    if (partnerOffer.coins > 0) {
      const [r] = await q('SELECT balance FROM economy_users WHERE guild_id = ? AND user_id = ? FOR UPDATE', [guildId, partnerId]);
      if (!r || r.balance < partnerOffer.coins) return { ok: false, error: `<@${partnerId}> no longer has ${partnerOffer.coins} coins.` };
    }
    for (const item of partnerOffer.items) {
      const [r] = await q('SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ? FOR UPDATE', [guildId, partnerId, item.item_id]);
      if (!r || r.quantity < item.quantity) return { ok: false, error: `<@${partnerId}> no longer has ${item.quantity}x item #${item.item_id}.` };
    }

    // --- Move coins ---
    const moveCoins = async (from, to, amount) => {
      if (amount <= 0) return;
      await q('UPDATE economy_users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?', [amount, guildId, from]);
      await q('UPDATE economy_users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?', [amount, guildId, to]);
    };
    await moveCoins(proposerId, partnerId, proposerOffer.coins);
    await moveCoins(partnerId, proposerId, partnerOffer.coins);

    // --- Move items ---
    const moveItems = async (from, to, items) => {
      for (const item of items) {
        const [have] = await q('SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ?', [guildId, from, item.item_id]);
        if (have.quantity === item.quantity) {
          await q('DELETE FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ?', [guildId, from, item.item_id]);
        } else {
          await q('UPDATE inventory_items SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?', [item.quantity, guildId, from, item.item_id]);
        }
        await q(
          `INSERT INTO inventory_items (guild_id, user_id, item_id, quantity) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
          [guildId, to, item.item_id, item.quantity],
        );
      }
    };
    await moveItems(proposerId, partnerId, proposerOffer.items);
    await moveItems(partnerId, proposerId, partnerOffer.items);

    // --- Audit trail (one row per side per direction) ---
    const logTx = async (userId, amount, reason) => {
      await q('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
        [guildId, userId, amount, 'trade', reason]);
    };
    if (proposerOffer.coins > 0) {
      await logTx(proposerId, -proposerOffer.coins, `Trade #${trade.id}: gave coins to <@${partnerId}>`);
      await logTx(partnerId, proposerOffer.coins, `Trade #${trade.id}: received coins from <@${proposerId}>`);
    }
    if (partnerOffer.coins > 0) {
      await logTx(partnerId, -partnerOffer.coins, `Trade #${trade.id}: gave coins to <@${proposerId}>`);
      await logTx(proposerId, partnerOffer.coins, `Trade #${trade.id}: received coins from <@${partnerId}>`);
    }
    if (proposerOffer.items.length || partnerOffer.items.length) {
      await logTx(proposerId, 0, `Trade #${trade.id}: swapped items with <@${partnerId}>`);
      await logTx(partnerId, 0, `Trade #${trade.id}: swapped items with <@${proposerId}>`);
    }

    await q("UPDATE trades SET status = 'completed' WHERE id = ?", [trade.id]);
    return { ok: true };
  });

  return result || { ok: false, error: 'Database unavailable — trade could not be completed.' };
}

module.exports = { normalizeOffer, offerIsEmpty, describeOffer, executeTrade };
