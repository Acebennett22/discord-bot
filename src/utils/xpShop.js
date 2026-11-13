// XP role shop (1.6.2): PER-SERVER catalog — each guild sets its own items
// and prices in xp_shop_items. Members spend leveling XP (user_levels) to
// buy roles. No global catalog, no shared prices.
const db = require('./database');
const { getRank } = require('./leveling');

async function getShopItems(guildId) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT * FROM xp_shop_items WHERE guild_id = ? ORDER BY xp_price', [guildId]) || [];
}

async function addShopItem(guildId, roleId, xpPrice, createdBy) {
  await db.query(
    'INSERT INTO xp_shop_items (guild_id, role_id, xp_price, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE xp_price = VALUES(xp_price)',
    [guildId, roleId, xpPrice, createdBy || null],
  );
}

async function removeShopItem(guildId, roleId) {
  await db.query('DELETE FROM xp_shop_items WHERE guild_id = ? AND role_id = ?', [guildId, roleId]);
}

function botCanManageRole(guild, role) {
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, reason: 'The bot is not in this server.' };
  if (role.position >= botMember.roles.highest.position) {
    return { ok: false, reason: `The **${role.name}** role is above (or equal to) the bot's highest role — move the bot's role higher in Server Settings → Roles.` };
  }
  return { ok: true };
}

async function buyShopRole(guild, member, roleId) {
  const items = await getShopItems(guild.id);
  const item = items.find((i) => i.role_id === roleId);
  if (!item) return { ok: false, error: 'That role is not in this server\'s XP shop.' };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, error: 'That role no longer exists.' };
  if (member.roles.cache.has(roleId)) return { ok: false, error: `You already have **${role.name}**.` };
  const check = botCanManageRole(guild, role);
  if (!check.ok) return { ok: false, error: check.reason };
  const rank = await getRank(member.id, guild.id);
  const xp = rank?.xp || 0;
  if (xp < item.xp_price) return { ok: false, error: `**${role.name}** costs ${item.xp_price} XP — you have ${xp} XP.` };
  const newXp = xp - item.xp_price;
  const { levelForXp } = require('./leveling');
  await db.query('UPDATE user_levels SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?', [newXp, levelForXp(newXp), member.id, guild.id]);
  await member.roles.add(role);
  return { ok: true, role, price: item.xp_price, remainingXp: newXp };
}

module.exports = { getShopItems, addShopItem, removeShopItem, botCanManageRole, buyShopRole };
