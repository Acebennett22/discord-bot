// Autoresponder (1.14.3): automatic replies when a phrase appears in a
// message. `contains` (default) fires anywhere in the message; `exact`
// only fires when the whole message is the trigger. Different from
// /custom-add, which only fires on a single trigger word at the start.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getRules } = require('../../utils/autoresponders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('Admin only: automatic replies when a phrase appears in a message.')
    .addSubcommand((s) => s.setName('add').setDescription('Add an automatic reply')
      .addStringOption((o) => o.setName('trigger').setDescription('Phrase to watch for').setRequired(true).setMaxLength(128))
      .addStringOption((o) => o.setName('response').setDescription('What the bot replies with').setRequired(true).setMaxLength(2000))
      .addStringOption((o) => o.setName('match').setDescription('How the trigger matches').addChoices(
        { name: 'Contains (anywhere in the message)', value: 'contains' },
        { name: 'Exact (whole message must match)', value: 'exact' },
      )))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove an automatic reply')
      .addStringOption((o) => o.setName('trigger').setDescription('Trigger to remove').setRequired(true).setMaxLength(128)))
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn one reply on or off without deleting it')
      .addStringOption((o) => o.setName('trigger').setDescription('Trigger to toggle').setRequired(true).setMaxLength(128))
      .addBooleanOption((o) => o.setName('enabled').setDescription('true = on, false = off').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all automatic replies'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Autoresponders only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'Autoresponders are stored in MySQL — connect the database first.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rules = await getRules(interaction.guildId);
      if (!rules.length) return interaction.reply({ embeds: [infoEmbed('💬 Autoresponders', 'No automatic replies yet — add one with /autoresponder add.')] });
      const lines = rules.map((r) => `${r.enabled ? '✅' : '⏸️'} **${r.trigger}** (${r.match_type}, used ${r.use_count}×)\n> ${String(r.response).slice(0, 200)}`);
      return interaction.reply({ embeds: [infoEmbed(`💬 Autoresponders (${rules.length})`, lines.join('\n\n').slice(0, 4000))] });
    }
    const trigger = interaction.options.getString('trigger').trim();
    if (!trigger) return interaction.reply({ embeds: [errorEmbed('Empty trigger', 'Give a phrase to watch for.')] });
    if (sub === 'add') {
      const response = interaction.options.getString('response').trim();
      const match = interaction.options.getString('match') || 'contains';
      await db.query(
        `INSERT INTO autoresponders (guild_id, \`trigger\`, response, match_type, created_by)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE response = VALUES(response), match_type = VALUES(match_type), enabled = 1, created_by = VALUES(created_by)`,
        [interaction.guildId, trigger, response, match, interaction.user.id],
      );
      return interaction.reply({ embeds: [successEmbed('Autoresponder added', `When a message ${match === 'exact' ? 'is exactly' : 'contains'} **${trigger}**, I'll reply:\n> ${response.slice(0, 500)}`)] });
    }
    if (sub === 'remove') {
      const result = await db.query('DELETE FROM autoresponders WHERE guild_id = ? AND `trigger` = ?', [interaction.guildId, trigger]);
      if (!result || result.affectedRows === 0) {
        return interaction.reply({ embeds: [errorEmbed('Not found', `No autoresponder with trigger **${trigger}**.`)] });
      }
      return interaction.reply({ embeds: [successEmbed('Autoresponder removed', `**${trigger}** will no longer get an automatic reply.`)] });
    }
    // toggle
    const enabled = interaction.options.getBoolean('enabled');
    const result = await db.query('UPDATE autoresponders SET enabled = ? WHERE guild_id = ? AND `trigger` = ?', [enabled ? 1 : 0, interaction.guildId, trigger]);
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `No autoresponder with trigger **${trigger}**.`)] });
    }
    return interaction.reply({ embeds: [successEmbed(enabled ? 'Autoresponder on' : 'Autoresponder off', `**${trigger}** is now ${enabled ? '✅ live' : '⏸️ paused'}.`)] });
  },
};
