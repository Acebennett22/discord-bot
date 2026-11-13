const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestions-setup')
    .setDescription('Admin only: set the channel suggestions are posted to.')
    .addChannelOption((o) => o.setName('channel').setDescription('Suggestions channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel');
    const { saved } = await setGuildSettings(interaction.guildId, { suggestionChannelId: channel.id });
    const note = saved ? '' : '\n⚠️ MySQL is not connected — this is only kept in memory for this run.';
    return interaction.reply({ embeds: [successEmbed('Suggestions channel set', `Members can now submit ideas with /suggest — they'll be posted in ${channel} with 👍/👎 voting.${note}`)], ephemeral: true });
  },
};
