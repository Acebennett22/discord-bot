const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');
const { clearFlag, getFlag } = require('../../utils/botTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botflag-clear')
    .setDescription('Staff only: clear a bot flag (marks it reviewed, records who cleared it).')
    .addUserOption((o) => o.setName('user').setDescription('The account whose flag to clear').setRequired(true)),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bot flags are stored in MySQL (bot_flags).')], ephemeral: true });
    const target = interaction.options.getUser('user');
    const flag = await getFlag(interaction.guildId, target.id);
    if (!flag || flag.status !== 'open') return interaction.reply({ embeds: [errorEmbed('No open flag', `<@${target.id}> has no open bot flag to clear.`)], ephemeral: true });
    const cleared = await clearFlag(interaction.guildId, target.id, interaction.user.id);
    if (!cleared) return interaction.reply({ embeds: [errorEmbed('Clear failed', 'The flag could not be cleared — try again.')], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Flag cleared', `<@${target.id}>'s bot flag (score ${flag.score}/100) has been cleared by <@${interaction.user.id}>. It stays in the database as reviewed — it is not deleted.`)], ephemeral: true });
  },
};
