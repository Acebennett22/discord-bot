const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const snipe = require('../../utils/snipe');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Staff: show the last deleted message in a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (defaults to this one)')),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has('ManageMessages') && !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Staff only', 'You need Manage Messages to snipe deleted messages.')], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const sniped = snipe.getDeleted(channel.id);
    if (!sniped) return interaction.reply({ embeds: [infoEmbed('🔍 Snipe', `Nothing was deleted in <#${channel.id}> in the last 10 minutes.`)], ephemeral: true });
    const embed = infoEmbed('🔍 Sniped message', `${sniped.content || '*[no text — image or embed only]*'}\n\n— <@${sniped.authorId}> (<t:${Math.floor(sniped.deletedAt / 1000)}:R>)`);
    embed.setAuthor({ name: sniped.authorTag, iconURL: sniped.avatarUrl });
    if (sniped.attachments?.length) embed.setImage(sniped.attachments[0]);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
