const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { sanitizeResponse } = require('../../utils/customCommands');
const { getCommandNames } = require('../../utils/commandNames');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-add')
    .setDescription('Admin only: add a custom trigger-word command.')
    .addStringOption((o) => o.setName('trigger').setDescription('Single trigger word (lowercase, no spaces)').setRequired(true).setMaxLength(64))
    .addStringOption((o) => o.setName('response').setDescription('What the bot replies with').setRequired(true).setMaxLength(2000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Custom commands only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to add custom commands.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so custom commands can\'t be saved right now.')] });
    const trigger = interaction.options.getString('trigger').trim().toLowerCase();
    const response = sanitizeResponse(interaction.options.getString('response'));
    if (!/^[a-z0-9_-]+$/.test(trigger)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid trigger', 'The trigger must be a single word using only lowercase letters, numbers, `-` or `_`.')] });
    }
    const builtIn = getCommandNames();
    if (builtIn.has(trigger)) {
      return interaction.reply({ embeds: [errorEmbed('Trigger taken', `**${trigger}** is already a built-in slash command — pick a different trigger.`)] });
    }
    await db.query(
      'INSERT INTO custom_commands (guild_id, trigger_word, response, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE response = VALUES(response), created_by = VALUES(created_by)',
      [interaction.guildId, trigger, response, interaction.user.id],
    );
    return interaction.reply({ embeds: [successEmbed('Custom command added', `When someone types **${trigger}**, I'll reply with:\n> ${response.slice(0, 500)}`)] });
  },
};
