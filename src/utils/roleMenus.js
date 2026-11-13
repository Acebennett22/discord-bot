// Button role menus — select-menu based role pickers (no reactions needed).
// Selecting an option toggles that role. The reaction-role requirements
// (required role / min days in server / min leveling level, 1.2.6) apply
// here too — stored per menu item.
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('./database');
const { getRank } = require('./leveling');

const MAX_OPTIONS = 25; // Discord select-menu limit.

async function createMenu(guildId, channelId, title, description) {
  const rows = await db.query(
    'INSERT INTO role_menus (guild_id, channel_id, title, description) VALUES (?, ?, ?, ?)',
    [guildId, channelId, title, description || null],
  );
  return rows?.insertId || null;
}

async function updateMenuMessage(menuId, messageId) {
  await db.query('UPDATE role_menus SET message_id = ? WHERE id = ?', [messageId, menuId]);
}

async function getMenu(guildId, menuId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM role_menus WHERE guild_id = ? AND id = ?', [guildId, menuId]);
  return rows?.[0] || null;
}

async function listMenus(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    `SELECT m.*, (SELECT COUNT(*) FROM role_menu_items i WHERE i.menu_id = m.id) AS item_count
     FROM role_menus m WHERE m.guild_id = ? ORDER BY m.id DESC`, [guildId],
  )) || [];
}

async function getMenuItems(menuId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM role_menu_items WHERE menu_id = ? ORDER BY id', [menuId])) || [];
}

async function addMenuItem(menuId, roleId, label, emoji, description, requirements) {
  const items = await getMenuItems(menuId);
  if (items.length >= MAX_OPTIONS) return { ok: false, error: `A role menu can have at most ${MAX_OPTIONS} options.` };
  if (items.some((i) => i.role_id === roleId)) return { ok: false, error: 'That role is already on this menu.' };
  await db.query(
    `INSERT INTO role_menu_items (menu_id, role_id, label, emoji, description, required_role_id, min_days_in_server, min_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [menuId, roleId, label, emoji || null, description || null,
     requirements?.requiredRoleId || null, requirements?.minDays ?? null, requirements?.minLevel ?? null],
  );
  return { ok: true };
}

async function removeMenuItem(menuId, roleId) {
  const res = await db.query('DELETE FROM role_menu_items WHERE menu_id = ? AND role_id = ?', [menuId, roleId]);
  return (res?.affectedRows ?? 0) > 0;
}

async function deleteMenu(guildId, menuId) {
  const res = await db.query('DELETE FROM role_menus WHERE guild_id = ? AND id = ?', [guildId, menuId]);
  return (res?.affectedRows ?? 0) > 0;
}

function buildMenuComponents(menuId, items) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolemenu:${menuId}`)
    .setPlaceholder('Pick a role — select again to remove it')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(items.map((i) => {
      const opt = { label: i.label.slice(0, 100), value: i.role_id, description: (i.description || '').slice(0, 100) || undefined };
      if (i.emoji) opt.emoji = i.emoji;
      return opt;
    }));
  return [new ActionRowBuilder().addComponents(menu)];
}

async function checkItemRequirements(member, item) {
  const missed = [];
  if (item.required_role_id && !member.roles.cache.has(item.required_role_id)) {
    missed.push(`You need the <@&${item.required_role_id}> role first.`);
  }
  if (item.min_days_in_server !== null && item.min_days_in_server !== undefined) {
    const joinedAt = member.joinedTimestamp;
    const days = joinedAt ? Math.floor((Date.now() - joinedAt) / 86_400_000) : 0;
    if (days < item.min_days_in_server) {
      missed.push(`You need to have been in the server for at least ${item.min_days_in_server} days (you're at ${days}).`);
    }
  }
  if (item.min_level !== null && item.min_level !== undefined) {
    const rank = await getRank(member.user.id, member.guild.id).catch(() => null);
    const level = rank?.level ?? 0;
    if (level < item.min_level) {
      missed.push(`You need leveling level ${item.min_level} or higher (you're level ${level}).`);
    }
  }
  return missed;
}

module.exports = {
  MAX_OPTIONS, createMenu, updateMenuMessage, getMenu, listMenus, getMenuItems, addMenuItem,
  removeMenuItem, deleteMenu, buildMenuComponents, checkItemRequirements,
};
