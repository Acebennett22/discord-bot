// Inventory + shop catalogue helpers shared by /buy, /sell, /inventory,
// /open-crate, /use, /trade, /daily and /shop.
// Items live in shop_items (per guild); owned stacks live in
// inventory_items. Roles are NOT inventoried — buying a role item grants
// the Discord role directly. All coin movement goes through
// economy.addCoins so it lands in economy_transactions.
const db = require('./database');
const config = require('./config');
const { getBalance, addCoins, getOrCreateUser } = require('./economy');

// Default crate catalogue (config.json economy.crates overrides prices).
// crate_contents entries: {kind:'coins', min, max, weight} or
// {kind:'item', item_name, weight} (looked up by name in the same guild).
function defaultCrates() {
  const prices = (config.economy && config.economy.crates) || {};
  return [
    {
      name: 'Common Crate', emoji: '📦', price: prices.common ?? 500,
      description: 'A sturdy box. Usually coins, sometimes something better.',
      contents: [
        { kind: 'coins', min: 50, max: 150, weight: 60 },
        { kind: 'coins', min: 150, max: 300, weight: 25 },
        { kind: 'item', item_name: 'Rare Crate', weight: 10 },
        { kind: 'coins', min: 1000, max: 1000, weight: 5 },
      ],
    },
    {
      name: 'Rare Crate', emoji: '🎁', price: prices.rare ?? 1500,
      description: 'Glows faintly. Worth the gamble.',
      contents: [
        { kind: 'coins', min: 200, max: 500, weight: 50 },
        { kind: 'coins', min: 500, max: 1000, weight: 30 },
        { kind: 'item', item_name: 'Legendary Crate', weight: 15 },
        { kind: 'coins', min: 5000, max: 5000, weight: 5 },
      ],
    },
    {
      name: 'Legendary Crate', emoji: '👑', price: prices.legendary ?? 5000,
      description: 'For high rollers only. The jackpot lives here.',
      contents: [
        { kind: 'coins', min: 1000, max: 2500, weight: 40 },
        { kind: 'coins', min: 2500, max: 5000, weight: 35 },
        { kind: 'coins', min: 5000, max: 10000, weight: 20 },
        { kind: 'coins', min: 25000, max: 25000, weight: 5 },
      ],
    },
  ];
}

// Default consumable: the daily loot table hands these out, and /use spends one.
const LUCKY_COIN = {
  name: 'Lucky Coin', emoji: '🍀', price: 200, type: 'consumable',
  description: 'Use it with /use for a random 50–200 coin payout.',
};

async function getShopItems(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY price ASC', [guildId])) || [];
}

async function getShopItem(guildId, itemId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM shop_items WHERE guild_id = ? AND id = ?', [guildId, itemId]);
  return rows?.[0] || null;
}

async function getShopItemByName(guildId, name) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM shop_items WHERE guild_id = ? AND name = ?', [guildId, name]);
  return rows?.[0] || null;
}

// Make sure the three default crates + Lucky Coin exist in this guild's
// shop (created once, by the bot, marked created_by 'system'). Called
// lazily from /shop, /daily and /open-crate so a fresh guild just works.
async function ensureDefaultItems(guildId) {
  if (!db.isEnabled()) return;
  const existing = await getShopItems(guildId);
  const names = new Set(existing.map((i) => i.name));
  for (const crate of defaultCrates()) {
    if (names.has(crate.name)) continue;
    await db.query(
      'INSERT INTO shop_items (guild_id, name, description, price, emoji, type, crate_contents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [guildId, crate.name, crate.description, crate.price, crate.emoji, 'crate', JSON.stringify(crate.contents), 'system'],
    );
  }
  if (!names.has(LUCKY_COIN.name)) {
    await db.query(
      'INSERT INTO shop_items (guild_id, name, description, price, emoji, type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [guildId, LUCKY_COIN.name, LUCKY_COIN.description, LUCKY_COIN.price, LUCKY_COIN.emoji, LUCKY_COIN.type, 'system'],
    );
  }
}

function sellPriceOf(item) {
  if (item.sell_price != null) return Math.min(item.sell_price, item.price);
  return Math.floor(item.price / 2);
}

function itemLabel(item) {
  return `${item.emoji ? `${item.emoji} ` : ''}**${item.name}**`;
}

// --- Inventory ---
async function getInventory(guildId, userId) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    `SELECT i.*, s.name, s.description, s.emoji, s.type, s.price, s.sell_price, s.role_id
       FROM inventory_items i JOIN shop_items s ON s.id = i.item_id
      WHERE i.guild_id = ? AND i.user_id = ? ORDER BY s.name ASC`,
    [guildId, userId],
  )) || [];
}

async function getInventoryQuantity(guildId, userId, itemId) {
  if (!db.isEnabled()) return 0;
  const rows = await db.query(
    'SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ?',
    [guildId, userId, itemId],
  );
  return rows?.[0]?.quantity || 0;
}

async function addItem(guildId, userId, itemId, quantity = 1) {
  await db.query(
    `INSERT INTO inventory_items (guild_id, user_id, item_id, quantity) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
    [guildId, userId, itemId, quantity],
  );
}

async function removeItem(guildId, userId, itemId, quantity = 1) {
  const rows = await db.query(
    'SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ?',
    [guildId, userId, itemId],
  );
  const have = rows?.[0]?.quantity || 0;
  if (have < quantity) return false;
  if (have === quantity) {
    await db.query('DELETE FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_id = ?', [guildId, userId, itemId]);
  } else {
    await db.query('UPDATE inventory_items SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?', [quantity, guildId, userId, itemId]);
  }
  return true;
}

// --- Daily deal (one item per guild per day, 25% off) ---
async function getDailyDeal(guildId) {
  if (!db.isEnabled()) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.query(
    'SELECT d.*, s.name, s.price, s.emoji FROM daily_deals d JOIN shop_items s ON s.id = d.item_id WHERE d.guild_id = ? AND d.deal_date = ?',
    [guildId, today],
  );
  if (rows?.length) return rows[0];
  const items = await getShopItems(guildId);
  if (!items.length) return null;
  const pick = items[Math.floor(Math.random() * items.length)];
  await db.query(
    'INSERT INTO daily_deals (guild_id, deal_date, item_id, discount_percent) VALUES (?, ?, ?, 25) ON DUPLICATE KEY UPDATE item_id = VALUES(item_id)',
    [guildId, today, pick.id],
  );
  return { guild_id: guildId, deal_date: today, item_id: pick.id, discount_percent: 25, name: pick.name, price: pick.price, emoji: pick.emoji };
}

function dealPrice(item, deal) {
  if (deal && String(deal.item_id) === String(item.id)) {
    return Math.max(1, Math.floor(item.price * (100 - (deal.discount_percent ?? 25)) / 100));
  }
  return item.price;
}

// --- Buying (shared by /buy and /shop buy:) ---
// Returns { ok, error?, item?, unitPrice?, total? }.
async function buyItem(interaction, item, quantity) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (quantity < 1) return { ok: false, error: 'Quantity must be at least 1.' };
  if (item.type === 'role' && quantity !== 1) return { ok: false, error: 'Role items can only be bought one at a time.' };
  const deal = await getDailyDeal(guildId);
  const unitPrice = dealPrice(item, deal);
  const total = unitPrice * quantity;
  const bal = await getBalance(guildId, userId);
  if (!bal) return { ok: false, error: 'Economy is offline right now (database unavailable).' };
  if (bal.balance < total) return { ok: false, error: `That costs ${total} coins, but you only have ${bal.balance} in your wallet.` };
  if (item.type === 'role' && item.role_id) {
    try {
      if (interaction.member.roles.cache.has(item.role_id)) return { ok: false, error: 'You already have that role.' };
    } catch {}
  }
  await addCoins(guildId, userId, -total, 'shop_buy', `Bought ${quantity}x ${item.name} (#${item.id})${deal && String(deal.item_id) === String(item.id) ? ' (daily deal)' : ''}`);
  let roleNote = '';
  if (item.type === 'role' && item.role_id) {
    try {
      await interaction.member.roles.add(item.role_id);
      roleNote = `\nThe <@&${item.role_id}> role has been granted!`;
    } catch {
      roleNote = `\n⚠️ Paid, but I couldn't grant the role — check my role permissions and that the role is below mine.`;
    }
  } else {
    await addItem(guildId, userId, item.id, quantity);
  }
  return { ok: true, item, unitPrice, total, roleNote, onDeal: deal && String(deal.item_id) === String(item.id) };
}

// --- Crates ---
function rollCrateContents(item) {
  let contents = [];
  try { contents = item.crate_contents ? JSON.parse(item.crate_contents) : []; } catch { contents = []; }
  if (!contents.length) return null;
  const totalWeight = contents.reduce((s, c) => s + (c.weight || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const entry of contents) {
    roll -= entry.weight || 1;
    if (roll <= 0) return entry;
  }
  return contents[contents.length - 1];
}

module.exports = {
  defaultCrates, LUCKY_COIN, getShopItems, getShopItem, getShopItemByName,
  ensureDefaultItems, sellPriceOf, itemLabel, getInventory, getInventoryQuantity,
  addItem, removeItem, getDailyDeal, dealPrice, buyItem, rollCrateContents,
  getBalance, addCoins, getOrCreateUser,
};
