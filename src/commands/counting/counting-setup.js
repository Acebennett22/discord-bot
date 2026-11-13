const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setSettings } = require('../../utils/counting');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting-setup')
    .setDescription('Admin only: set the counting channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel where members count up').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    if (!(await setSettings(interaction.guildId, channel.id))) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Counting needs MySQL.')], ephemeral: true });
    }
    return interaction.reply({
      embeds: [successEmbed('Counting set up', `Counting now happens in <#${channel.id}>.\nEach message must start with the next number (1, 2, 3…). A wrong number or the same person counting twice in a row resets the count to 0.`)],
      ephemeral: true,
    });
  },
};
