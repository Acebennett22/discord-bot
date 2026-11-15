const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),
  async execute(interaction) {
    const g = interaction.guild;
    const embed = infoEmbed(`Server info — ${g.name}`, [
      `**Owner:** <@${g.ownerId}>`,
      `**Members:** ${g.memberCount}`,
      `**Created:** <t:${Math.floor(g.createdTimestamp / 1000)}:D>`,
      `**Channels:** ${g.channels.cache.size}`,
      `**Roles:** ${g.roles.cache.size}`,
      `**Boosts:** ${g.premiumSubscriptionCount || 0} (Tier ${g.premiumTier})`,
    ].join('\n'));
    if (g.iconURL()) embed.setThumbnail(g.iconURL());
    return interaction.reply({  embeds: [embed] });
  },
};
