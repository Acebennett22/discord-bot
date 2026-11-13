const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { saveMilestoneSettings, getMilestoneSettings } = require('../../utils/milestones');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('milestone-setup')
    .setDescription('Admin only: set the channel for member-milestone celebrations.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for milestone announcements').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Milestones need MySQL.')], ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    await saveMilestoneSettings(interaction.guildId, { channelId: channel.id, enabled: true });
    return interaction.reply({ embeds: [successEmbed('Milestones set up', `🎉 Member milestones (100, 250, 500, 1000…) will be celebrated in <#${channel.id}>. The member who triggers one earns 100 coins.`)], ephemeral: true });
  },
};
