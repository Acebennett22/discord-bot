// Temp VC hubs (1.16.17): /tempvc setup add|remove|list.
// Each hub is a "join to create" voice channel in one category — joining
// it spins up a personal temp channel in that category, deleted when
// empty. `add` creates the hub channel in Discord itself: the admin picks
// the category and gives the channel a name, and the bot makes it.
// A server can have up to MAX_HUBS hubs (see src/utils/tempvc.js).
// The old single-hub form (create_channel + category + enabled options)
// is gone; a server that still has the legacy guild settings keeps
// working, and its hub is migrated into the hubs table the first time any
// of these subcommands runs, so it shows up in `list` and can be removed.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings } = require('../../utils/guildSettings');
const {
  listHubs, getHub, migrateLegacyHub, registerHub, unregisterHub, MAX_HUBS, clearLegacySettingsIfMatches,
} = require('../../utils/tempvc');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvc-setup')
    .setDescription('Admin only: manage temporary voice channel hubs for this server.')
    .addSubcommand((s) => s.setName('add').setDescription('Create a new temp VC hub channel in a category.')
      .addChannelOption((o) => o.setName('category').setDescription('Category the hub channel is created in').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('Name for the new hub channel').setRequired(true).setMinLength(1).setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a temp VC hub (deletes the channel if the bot made it).')
      .addChannelOption((o) => o.setName('create_channel').setDescription('The hub channel to remove').addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server\'s temp VC hubs.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Temp VC setup needs MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addHub(interaction);
    if (sub === 'remove') return removeHub(interaction);
    if (sub === 'list') return listHubsCommand(interaction);
    return interaction.reply({ embeds: [errorEmbed('Unknown action', 'Unknown temp VC setup action.')] });
  },
};

async function addHub(interaction) {
  const category = interaction.options.getChannel('category');
  const name = interaction.options.getString('name').trim();
  if (!name) return interaction.reply({ embeds: [errorEmbed('Bad name', 'Give the hub channel a name.')] });
  const settings = await getGuildSettings(interaction.guildId);
  await migrateLegacyHub(interaction.guildId, settings);
  const hubs = await listHubs(interaction.guildId);
  if (hubs.length >= MAX_HUBS) {
    return interaction.reply({ embeds: [errorEmbed('Too many hubs', `This server already has the maximum of **${MAX_HUBS}** temp VC hubs. Remove one first with \`/tempvc setup remove\`.`)] });
  }
  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
  } catch (err) {
    // DiscordAPIError 50013 = Missing Permissions (bot lacks Manage
    // Channels); anything else is a bad category or a Discord-side failure.
    const msg = err?.code === 50013
      ? 'I need the **Manage Channels** permission to create the hub channel.'
      : 'I could not create that channel — check my permissions and that the category still exists.';
    return interaction.reply({ embeds: [errorEmbed('Could not create channel', msg)] });
  }
  const { error } = await registerHub(interaction.guildId, channel.id, category.id, 1);
  if (error) {
    // The channel exists in Discord but the hub did not save — delete it
    // again rather than leave an orphan channel that spawns nothing.
    await channel.delete('Temp VC hub save failed').catch(() => {});
    return interaction.reply({ embeds: [errorEmbed('Could not save hub', `The channel was removed again — the hub could not be saved: ${error.sqlMessage || error.message}`)] });
  }
  return interaction.reply({ embeds: [successEmbed('Temp VC hub added', [
    `Hub channel: <#${channel.id}>`,
    `Category: **${category.name}**`,
    `Hubs: **${hubs.length + 1}/${MAX_HUBS}**`,
    'Members who join the hub channel will get their own temp voice channel in that category, deleted when empty.',
  ].join('\n'))] });
}

async function removeHub(interaction) {
  const channel = interaction.options.getChannel('create_channel');
  const settings = await getGuildSettings(interaction.guildId);
  await migrateLegacyHub(interaction.guildId, settings);
  const hub = await getHub(interaction.guildId, channel.id);
  if (!hub) {
    return interaction.reply({ embeds: [errorEmbed('Not a hub', `<#${channel.id}> is not a registered temp VC hub. See the hubs with \`/tempvc setup list\`.`)] });
  }
  await unregisterHub(interaction.guildId, channel.id);
  await clearLegacySettingsIfMatches(interaction.guildId, hub, settings);
  let deleted = false;
  if (hub.created_by_bot) {
    const live = interaction.guild.channels.cache.get(channel.id);
    if (live) {
      await live.delete('Temp VC hub removed').catch(() => {});
      deleted = true;
    } else {
      deleted = true; // Already gone from Discord.
    }
  }
  const line = hub.created_by_bot
    ? `Removed the **${channel.name}** hub${deleted ? ' and deleted the channel.' : ' — the channel could not be deleted, but the hub is unregistered.'}`
    : `Unregistered the **${channel.name}** hub. The channel itself was left alone — the bot did not create it.`;
  return interaction.reply({ embeds: [successEmbed('Temp VC hub removed', line)] });
}

async function listHubsCommand(interaction) {
  const settings = await getGuildSettings(interaction.guildId);
  await migrateLegacyHub(interaction.guildId, settings);
  const hubs = await listHubs(interaction.guildId);
  if (!hubs.length) {
    return interaction.reply({ embeds: [successEmbed('Temp VC hubs', 'No temp VC hubs yet. Add one with `/tempvc setup add`.')] });
  }
  const lines = hubs.map((h) => {
    const ch = interaction.guild.channels.cache.get(h.create_channel_id);
    const cat = h.category_id ? interaction.guild.channels.cache.get(h.category_id) : null;
    const chLabel = ch ? `<#${ch.id}>` : `⚠️ missing channel (${h.create_channel_id})`;
    const catLabel = !h.category_id ? 'no category' : (cat ? `**${cat.name}**` : `⚠️ missing category (${h.category_id})`);
    // A hub whose channel is gone from Discord cannot be picked in
    // /tempvc setup remove (the picker only lists live channels) — the
    // dashboard Temp VC tab is the way to clean those up.
    const stale = (!ch || (h.category_id && !cat))
      ? ' — stale; remove it from the dashboard Temp VC tab.'
      : '';
    return `• ${chLabel} → ${catLabel}${stale}`;
  });
  return interaction.reply({ embeds: [successEmbed(`Temp VC hubs (${hubs.length}/${MAX_HUBS})`, lines.join('\n'))] });
}
