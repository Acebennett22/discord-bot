const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const automod = require('../../utils/automod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod-exempt')
    .setDescription('Admin only: manage roles/channels exempt from Automod.')
    .addSubcommand((s) => s.setName('add-role').setDescription('Exempt a role').addRoleOption((o) => o.setName('role').setDescription('Role to exempt').setRequired(true)))
    .addSubcommand((s) => s.setName('remove-role').setDescription('Remove a role exemption').addRoleOption((o) => o.setName('role').setDescription('Role to un-exempt').setRequired(true)))
    .addSubcommand((s) => s.setName('add-channel').setDescription('Exempt a channel').addChannelOption((o) => o.setName('channel').setDescription('Channel to exempt').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('remove-channel').setDescription('Remove a channel exemption').addChannelOption((o) => o.setName('channel').setDescription('Channel to un-exempt').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all exemptions'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const settings = await automod.getSettings(interaction.guildId);
    if (sub === 'list') {
      const embed = infoEmbed('🛡️ Automod exemptions', 'Exempt roles and channels bypass every Automod check (spam, banned words, links, invites). Admins are always exempt.');
      embed.addFields(
        { name: 'Roles', value: settings.exemptRoles.length ? settings.exemptRoles.map((r) => `<@&${r}>`).join(' ') : 'none', inline: false },
        { name: 'Channels', value: settings.exemptChannels.length ? settings.exemptChannels.map((c) => `<#${c}>`).join(' ') : 'none', inline: false },
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    const isRole = sub.includes('role');
    const id = isRole ? interaction.options.getRole('role').id : interaction.options.getChannel('channel').id;
    const label = isRole ? `<@&${id}>` : `<#${id}>`;
    const key = isRole ? 'exemptRoles' : 'exemptChannels';
    let list = [...settings[key]];
    if (sub.startsWith('add')) {
      if (list.includes(id)) return interaction.reply({ embeds: [errorEmbed('Already exempt', `${label} is already exempt from Automod.`)], ephemeral: true });
      list.push(id);
    } else {
      if (!list.includes(id)) return interaction.reply({ embeds: [errorEmbed('Not exempt', `${label} is not exempt from Automod.`)], ephemeral: true });
      list = list.filter((x) => x !== id);
    }
    await automod.setSettings(interaction.guildId, { [key]: list });
    return interaction.reply({ embeds: [successEmbed(sub.startsWith('add') ? 'Exemption added' : 'Exemption removed', sub.startsWith('add') ? `${label} now bypasses all Automod checks.` : `${label} is no longer exempt from Automod.`)], ephemeral: true });
  },
};
