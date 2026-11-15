// Logging setup (1.14.2): one channel for member joins/leaves, bans,
// kicks, timeouts, and role changes — each toggleable. Message
// deletes/edits stay on the modlog (/modlog-setup); Automod actions stay
// on the Automod log channel. Point them all at the same channel if you
// want a single audit feed.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const memberLog = require('../../utils/memberLog');

const TOGGLES = [
  ['joins', 'logJoins', 'Member joins'],
  ['leaves', 'logLeaves', 'Member leaves'],
  ['bans', 'logBans', 'Bans / unbans'],
  ['kicks', 'logKicks', 'Kicks'],
  ['timeouts', 'logTimeouts', 'Timeouts'],
  ['roles', 'logRoleChanges', 'Role changes'],
];

function summary(settings) {
  return [
    `Channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set'}`,
    ...TOGGLES.map(([key, prop, label]) => `${settings[prop] ? '✅' : '❌'} ${label}`),
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Admin only: set up member + moderation event logging.')
    .addSubcommand((s) => s.setName('setup').setDescription('Set the log channel and which events to log')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post logs in').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addBooleanOption((o) => o.setName('joins').setDescription('Log member joins'))
      .addBooleanOption((o) => o.setName('leaves').setDescription('Log member leaves'))
      .addBooleanOption((o) => o.setName('bans').setDescription('Log bans and unbans'))
      .addBooleanOption((o) => o.setName('kicks').setDescription('Log kicks'))
      .addBooleanOption((o) => o.setName('timeouts').setDescription('Log timeouts'))
      .addBooleanOption((o) => o.setName('roles').setDescription('Log role changes')))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current logging settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Logging only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'Logging settings are stored in MySQL — connect the database first.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const settings = await memberLog.getSettings(interaction.guildId);
      return interaction.reply({ embeds: [statsEmbed('📋 Member logging', summary(settings))] });
    }
    const patch = { logChannelId: interaction.options.getChannel('channel').id };
    for (const [opt, prop] of TOGGLES) {
      const v = interaction.options.getBoolean(opt);
      if (v !== null) patch[prop] = v;
    }
    const { saved, settings } = await memberLog.setSettings(interaction.guildId, patch);
    if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'MySQL is not connected — settings were kept in memory only.')] });
    return interaction.reply({ embeds: [successEmbed('Logging updated', summary(settings))]  });
  },
};
