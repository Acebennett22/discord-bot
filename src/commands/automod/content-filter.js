// Content filter (1.14.5): blocked words and harmful-link domains, each
// with its own action and severity. `add` takes a word (matched on word
// boundaries) or a domain (matched against link hostnames, subdomains
// included). No built-in list — the server defines its own entries.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const contentFilter = require('../../utils/contentFilter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('content-filter')
    .setDescription('Admin only: blocked words and harmful-link domains, each with its own action.')
    .addSubcommand((s) => s.setName('add').setDescription('Add a blocked word or domain')
      .addStringOption((o) => o.setName('type').setDescription('What to block').setRequired(true).addChoices(
        { name: 'Word / phrase', value: 'word' },
        { name: 'Link domain', value: 'domain' },
      ))
      .addStringOption((o) => o.setName('value').setDescription('The word, or a domain like scam-example.com').setRequired(true).setMaxLength(128))
      .addStringOption((o) => o.setName('action').setDescription('What happens on a hit (default: delete + warn)').addChoices(
        { name: 'Delete only', value: 'delete' },
        { name: 'Warn only', value: 'warn' },
        { name: 'Timeout only', value: 'timeout' },
        { name: 'Delete + warn', value: 'delete_warn' },
        { name: 'Delete + timeout', value: 'delete_timeout' },
      ))
      .addStringOption((o) => o.setName('severity').setDescription('How serious this is (default: medium)').addChoices(
        { name: 'Low', value: 'low' },
        { name: 'Medium', value: 'medium' },
        { name: 'High', value: 'high' },
      )))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a blocked word or domain')
      .addStringOption((o) => o.setName('type').setDescription('What to remove').setRequired(true).addChoices(
        { name: 'Word / phrase', value: 'word' },
        { name: 'Link domain', value: 'domain' },
      ))
      .addStringOption((o) => o.setName('value').setDescription('The word or domain to remove').setRequired(true).setMaxLength(128)))
    .addSubcommand((s) => s.setName('list').setDescription('List all content-filter rules'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The content filter only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'Content-filter rules are stored in MySQL — connect the database first.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rules = await contentFilter.getRules(interaction.guildId);
      if (!rules.length) return interaction.reply({ embeds: [infoEmbed('🛡️ Content filter', 'No rules yet — add one with /content-filter add.\n\nTip: use type "word" for slurs and banned phrases, type "domain" for scam/phishing sites (subdomains included).')] });
      const lines = rules.map((r) => `${r.severity === 'high' ? '🔴' : r.severity === 'low' ? '🟢' : '🟡'} **${r.value}** (${r.type}, ${r.action}, ${r.severity})`);
      return interaction.reply({ embeds: [infoEmbed(`🛡️ Content filter (${rules.length})`, lines.join('\n').slice(0, 4000))] });
    }
    const type = interaction.options.getString('type');
    const value = interaction.options.getString('value').trim().toLowerCase();
    if (!value) return interaction.reply({ embeds: [errorEmbed('Empty value', 'Give a word or a domain to block.')] });
    if (type === 'domain' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid domain', `"${value}" doesn't look like a domain — use something like \`scam-example.com\` (no http://, no path).`)] });
    }
    if (sub === 'add') {
      const action = interaction.options.getString('action') || 'delete_warn';
      const severity = interaction.options.getString('severity') || 'medium';
      await db.query(
        `INSERT INTO content_filter_rules (guild_id, type, value, action, severity, created_by)
         VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE action = VALUES(action), severity = VALUES(severity), created_by = VALUES(created_by)`,
        [interaction.guildId, type, value, action, severity, interaction.user.id],
      );
      return interaction.reply({ embeds: [successEmbed('Rule added', type === 'word'
        ? `Messages containing **${value}** (word-boundary match) will now be handled with **${action}** (${severity} severity).`
        : `Links to **${value}** (and its subdomains) will now be handled with **${action}** (${severity} severity).`)] });
    }
    const result = await db.query('DELETE FROM content_filter_rules WHERE guild_id = ? AND type = ? AND value = ?', [interaction.guildId, type, value]);
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `No ${type} rule for **${value}**.`)] });
    }
    return interaction.reply({ embeds: [successEmbed('Rule removed', `**${value}** (${type}) is no longer blocked by the content filter.`)] });
  },
};
