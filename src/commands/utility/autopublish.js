const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const autopublish = require('../../utils/autopublish');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autopublish')
    .setDescription('Manage announcement channels that auto-publish their messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('add').setDescription('Admin: auto-publish messages in an announcement channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Admin: stop auto-publishing a channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List the channels that auto-publish.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Auto-publish needs MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const channels = await autopublish.getAutopublishChannels(interaction.guildId);
      if (!channels.length) return interaction.reply({ embeds: [infoEmbed('📣 Auto-publish', 'No announcement channels auto-publish yet. Add one with /autopublish add.')] });
      return interaction.reply({ embeds: [infoEmbed('📣 Auto-publish', `Messages posted in these announcement channels are published automatically:\n${channels.map((id) => `• <#${id}>`).join('\n')}`)] });
    }
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to change auto-publish settings.')] });
    }
    const channel = interaction.options.getChannel('channel');
    if (sub === 'add') {
      await autopublish.addChannel(interaction.guildId, channel.id);
      return interaction.reply({ embeds: [successEmbed('Auto-publish on', `Messages in <#${channel.id}> will now be published automatically.`)] });
    }
    await autopublish.removeChannel(interaction.guildId, channel.id);
    return interaction.reply({ embeds: [successEmbed('Auto-publish off', `Messages in <#${channel.id}> will no longer auto-publish.`)] });
  },
};
