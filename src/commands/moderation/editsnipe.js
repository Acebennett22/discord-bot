const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const snipe = require('../../utils/snipe');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editsnipe')
    .setDescription('Staff: show the last edited message in a channel (before/after).')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (defaults to this one)')),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has('ManageMessages') && !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Staff only', 'You need Manage Messages to snipe edited messages.')], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const sniped = snipe.getEdited(channel.id);
    if (!sniped) return interaction.reply({ embeds: [infoEmbed('🔍 Edit snipe', `Nothing was edited in <#${channel.id}> in the last 10 minutes.`)], ephemeral: true });
    const embed = infoEmbed('🔍 Edited message', `**Before:**\n${sniped.before || '*[empty]*'}\n\n**After:**\n${sniped.after || '*[empty]*'}\n\n— <@${sniped.authorId}> (<t:${Math.floor(sniped.editedAt / 1000)}:R>)`);
    embed.setAuthor({ name: sniped.authorTag, iconURL: sniped.avatarUrl });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
