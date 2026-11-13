const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const { getRules, formatRulesEmbed } = require('../../utils/serverRules');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Show the server rules.'),
  async execute(interaction) {
    const rules = await getRules(interaction.guildId);
    if (!rules) {
      return interaction.reply({ embeds: [errorEmbed('No rules set', 'This server has no rules set up yet — an admin can run /rules-setup to add them.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [formatRulesEmbed(rules.title, rules.content)], ephemeral: true });
  },
};
