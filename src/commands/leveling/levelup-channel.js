const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelup-channel')
    .setDescription('Set the channel where level-up role announcements are posted.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('set').setDescription('Admin: set the level-up announcement channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('clear').setDescription('Admin: stop posting level-up role announcements.'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current level-up announcement channel.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const settings = await getGuildSettings(interaction.guildId);
      return interaction.reply({ embeds: [infoEmbed('🏆 Level-up announcements', settings.levelupChannelId
        ? `Level-up role announcements post in <#${settings.levelupChannelId}>.`
        : 'No level-up announcement channel is set — level-ups are announced in the channel where the member leveled up. Use /levelup-channel set to pick one.')] });
    }
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to change the level-up channel.')] });
    }
    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      await setGuildSettings(interaction.guildId, { levelupChannelId: channel.id });
      return interaction.reply({ embeds: [successEmbed('Level-up channel set', `When a member levels up **and gains a role**, the bot will post an announcement in <#${channel.id}>.`)] });
    }
    await setGuildSettings(interaction.guildId, { levelupChannelId: '' });
    return interaction.reply({ embeds: [successEmbed('Level-up channel cleared', 'Level-up role announcements are off — level-ups are announced in the channel where the member leveled up.')] });
  },
};
