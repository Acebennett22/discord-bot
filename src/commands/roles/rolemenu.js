const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const menus = require('../../utils/roleMenus');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolemenu')
    .setDescription('Admin only: button role menus (select a role, toggle it on/off).')
    .addSubcommand((s) => s.setName('create').setDescription('Post a new role menu.')
      .addStringOption((o) => o.setName('title').setDescription('Menu title').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('Menu description').setMaxLength(500))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (default: this channel)')))
    .addSubcommand((s) => s.setName('add').setDescription('Add a role option to a menu.')
      .addIntegerOption((o) => o.setName('menu_id').setDescription('Menu ID (see /rolemenu list)').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to offer').setRequired(true))
      .addStringOption((o) => o.setName('label').setDescription('Option label').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji for the option'))
      .addStringOption((o) => o.setName('description').setDescription('Option description').setMaxLength(100))
      .addRoleOption((o) => o.setName('required_role').setDescription('Optional: member must already have this role'))
      .addIntegerOption((o) => o.setName('min_days').setDescription('Optional: member must have been in the server this many days').setMinValue(0).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('min_level').setDescription('Optional: member must be at least this leveling level').setMinValue(0).setMaxValue(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a role option from a menu.')
      .addIntegerOption((o) => o.setName('menu_id').setDescription('Menu ID').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server\'s role menus.'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a role menu (and its message).')
      .addIntegerOption((o) => o.setName('menu_id').setDescription('Menu ID').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Role menus need MySQL.')] });
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = await menus.listMenus(interaction.guildId);
      if (!list.length) return interaction.reply({ embeds: [infoEmbed('🎭 Role menus', 'No role menus in this server yet. Create one with /rolemenu create.')] });
      const lines = await Promise.all(list.map(async (m) => {
        const items = await menus.getMenuItems(m.id);
        return `**#${m.id} — ${m.title}** (${items.length} option${items.length === 1 ? '' : 's'}) — <#${m.channel_id}>`;
      }));
      return interaction.reply({ embeds: [infoEmbed('🎭 Role menus', lines.join('\n'))] });
    }

    if (sub === 'create') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const menuId = await menus.createMenu(interaction.guildId, channel.id, title, description);
      if (!menuId) return interaction.reply({ embeds: [errorEmbed('Could not create menu', 'The database insert failed — try again.')] });
      const posted = await channel.send({ embeds: [infoEmbed(`🎭 ${title}`, `${description || 'Pick a role from the menu below — select it again to remove it.'}\n\n*No roles yet — add some with /rolemenu add.*`)] });
      await menus.updateMenuMessage(menuId, posted.id);
      return interaction.reply({ embeds: [successEmbed('Role menu created', `🎭 Menu **#${menuId} — ${title}** posted in <#${channel.id}>. Add options with /rolemenu add (menu_id ${menuId}).`)] });
    }

    if (sub === 'add') {
      const menuId = interaction.options.getInteger('menu_id');
      const menu = await menus.getMenu(interaction.guildId, menuId);
      if (!menu) return interaction.reply({ embeds: [errorEmbed('Menu not found', `No role menu #${menuId} in this server.`)] });
      const role = interaction.options.getRole('role');
      const botTop = interaction.guild.members.me.roles.highest;
      if (role.position >= botTop.position) return interaction.reply({ embeds: [errorEmbed('Bot cannot manage that role', `**${role.name}** sits above the bot's highest role — move the bot's role higher first.`)] });
      const result = await menus.addMenuItem(menuId, role.id, interaction.options.getString('label'), interaction.options.getString('emoji'), interaction.options.getString('description'), {
        requiredRoleId: interaction.options.getRole('required_role')?.id,
        minDays: interaction.options.getInteger('min_days'),
        minLevel: interaction.options.getInteger('min_level'),
      });
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not add option', result.error)] });
      await refreshMenuMessage(interaction, menu);
      return interaction.reply({ embeds: [successEmbed('Option added', `🎭 **${role.name}** added to menu #${menuId}.`)] });
    }

    if (sub === 'remove') {
      const menuId = interaction.options.getInteger('menu_id');
      const menu = await menus.getMenu(interaction.guildId, menuId);
      if (!menu) return interaction.reply({ embeds: [errorEmbed('Menu not found', `No role menu #${menuId} in this server.`)] });
      const role = interaction.options.getRole('role');
      const ok = await menus.removeMenuItem(menuId, role.id);
      if (!ok) return interaction.reply({ embeds: [errorEmbed('Not on this menu', `**${role.name}** isn't an option on menu #${menuId}.`)] });
      await refreshMenuMessage(interaction, menu);
      return interaction.reply({ embeds: [successEmbed('Option removed', `🎭 **${role.name}** removed from menu #${menuId}.`)] });
    }

    // delete
    const menuId = interaction.options.getInteger('menu_id');
    const menu = await menus.getMenu(interaction.guildId, menuId);
    if (!menu) return interaction.reply({ embeds: [errorEmbed('Menu not found', `No role menu #${menuId} in this server.`)] });
    const channel = interaction.guild.channels.cache.get(menu.channel_id) || await interaction.guild.channels.fetch(menu.channel_id).catch(() => null);
    if (channel && menu.message_id) await channel.messages.delete(menu.message_id).catch(() => {});
    await menus.deleteMenu(interaction.guildId, menuId);
    return interaction.reply({ embeds: [successEmbed('Menu deleted', `🗑️ Role menu #${menuId} deleted.`)] });
  },
};

async function refreshMenuMessage(interaction, menu) {
  const channel = interaction.guild.channels.cache.get(menu.channel_id) || await interaction.guild.channels.fetch(menu.channel_id).catch(() => null);
  if (!channel || !menu.message_id) return;
  const msg = await channel.messages.fetch(menu.message_id).catch(() => null);
  if (!msg) return;
  const items = await menus.getMenuItems(menu.id);
  if (!items.length) return;
  await msg.edit({ components: menus.buildMenuComponents(menu.id, items) }).catch(() => {});
}
