const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { nextMilestone, progressBar } = require('../../utils/milestones');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('milestones')
    .setDescription('See the next member-count milestone and how close the server is.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Milestones need MySQL.')] });
    const memberCount = interaction.guild.memberCount;
    const { next } = await nextMilestone(interaction.guildId, memberCount);
    if (!next) {
      return interaction.reply({ embeds: [infoEmbed('🎉 Milestones', `**${memberCount}** members — every milestone on the list has been hit!`)] });
    }
    const prev = next === 100 ? 0 : next - 1;
    return interaction.reply({ embeds: [infoEmbed('🎉 Next milestone',
      `**${memberCount} / ${next}** members\n${progressBar(memberCount, next)} — **${next - memberCount}** more to go!\n\nWhen the server hits ${next} members, the member who triggers it earns a **100 coin** bonus.`)] });
  },
};
