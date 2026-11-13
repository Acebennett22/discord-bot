const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a user.')
    .addUserOption((o) => o.setName('user').setDescription('User to look up (defaults to you)')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
    const lines = [
      `**Tag:** ${user.tag}`,
      `**ID:** ${user.id}`,
      `**Bot:** ${user.bot ? 'Yes' : 'No'}`,
      `**Account created:** <t:${Math.floor(user.createdTimestamp / 1000)}:D>`,
    ];
    if (member) {
      lines.push(`**Joined server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`);
      lines.push(`**Roles:** ${member.roles.cache.filter((r) => r.name !== '@everyone').map((r) => r.toString()).join(', ') || 'None'}`);
    }
    const embed = infoEmbed(`User info — ${user.tag}`, lines.join('\n'));
    embed.setThumbnail(user.displayAvatarURL());
    return interaction.reply({ embeds: [embed] });
  },
};
