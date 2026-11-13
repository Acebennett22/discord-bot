const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confess-setup')
    .setDescription('Admin only: set up anonymous confessions for this server.')
    .addChannelOption((o) => o.setName('channel').setDescription('Text channel where approved confessions are posted').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addBooleanOption((o) => o.setName('approval').setDescription('Require staff approval before a confession is posted (default: true)'))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable confessions in this server (default: true)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const approval = interaction.options.getBoolean('approval') ?? true;
    const enabled = interaction.options.getBoolean('enabled') ?? true;
    const { saved } = await setGuildSettings(interaction.guildId, {
      confessionsChannelId: channel.id,
      confessionsRequireApproval: approval,
      confessionsEnabled: enabled,
    });
    return interaction.reply({
      embeds: [successEmbed('Confessions set up',
        `🤫 Confessions will be posted in <#${channel.id}>.\n**Enabled:** ${enabled ? 'yes' : 'no'}\n**Staff approval required:** ${approval ? 'yes' : 'no'}${approval ? '\nStaff review confessions in the modlog channel (approve/deny buttons).' : ''}\nMembers submit with /confess.${saved ? '' : '\n⚠️ Database is offline, so this setup was only kept in memory and will be lost on restart.'}`)],
      ephemeral: true,
    });
  },
};
