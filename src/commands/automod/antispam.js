// Antispam config (1.14.4): the extra spam detectors that sit on top of
// Automod's rate limit (X messages in Y seconds). Duplicate-message
// floods, ALL-CAPS shouting, mention spam, and link-count spam — each
// with its own on/off switch and thresholds, sharing one action.
// All detectors are OFF by default; turn on only what your server needs.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const automod = require('../../utils/automod');

const ACTIONS = ['delete', 'warn', 'timeout', 'delete_warn', 'delete_timeout'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Admin only: configure duplicate, caps, mention, and link spam detection.')
    .addBooleanOption((o) => o.setName('duplicate').setDescription('Block the same message repeated over and over'))
    .addIntegerOption((o) => o.setName('duplicate_max').setDescription('Same message this many times in 60s triggers (default 3)').setMinValue(2).setMaxValue(10))
    .addBooleanOption((o) => o.setName('caps').setDescription('Block ALL-CAPS shouting'))
    .addIntegerOption((o) => o.setName('caps_min_length').setDescription('Minimum letters before caps counts (default 10)').setMinValue(4).setMaxValue(100))
    .addIntegerOption((o) => o.setName('caps_percent').setDescription('Uppercase % that counts as shouting (default 70)').setMinValue(50).setMaxValue(100))
    .addBooleanOption((o) => o.setName('mentions').setDescription('Block messages with too many @mentions'))
    .addIntegerOption((o) => o.setName('mention_max').setDescription('Max mentions per message (default 5)').setMinValue(2).setMaxValue(20))
    .addIntegerOption((o) => o.setName('link_max').setDescription('Max links per message (0 = off, default 0)').setMinValue(0).setMaxValue(20))
    .addStringOption((o) => o.setName('action').setDescription('What happens on an antispam hit').addChoices(
      { name: 'Delete only', value: 'delete' },
      { name: 'Warn only', value: 'warn' },
      { name: 'Timeout only', value: 'timeout' },
      { name: 'Delete + warn', value: 'delete_warn' },
      { name: 'Delete + timeout', value: 'delete_timeout' },
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const patch = {};
    const getBool = (name) => interaction.options.getBoolean(name);
    const getInt = (name) => interaction.options.getInteger(name);
    if (getBool('duplicate') !== null) patch.dupEnabled = getBool('duplicate');
    if (getInt('duplicate_max') !== null) patch.dupMax = getInt('duplicate_max');
    if (getBool('caps') !== null) patch.capsEnabled = getBool('caps');
    if (getInt('caps_min_length') !== null) patch.capsMinLength = getInt('caps_min_length');
    if (getInt('caps_percent') !== null) patch.capsPercent = getInt('caps_percent');
    if (getBool('mentions') !== null) patch.mentionEnabled = getBool('mentions');
    if (getInt('mention_max') !== null) patch.mentionMax = getInt('mention_max');
    if (getInt('link_max') !== null) patch.linkMax = getInt('link_max');
    const action = interaction.options.getString('action');
    if (action) patch.antispamAction = ACTIONS.includes(action) ? action : 'delete_warn';
    if (!Object.keys(patch).length) {
      const s = await automod.getSettings(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('🛡️ Antispam — current settings', [
        `Duplicate: ${s.dupEnabled ? `on (same message ${s.dupMax}× in 60s)` : 'off'}`,
        `Caps: ${s.capsEnabled ? `on (${s.capsPercent}%+ uppercase, ${s.capsMinLength}+ letters)` : 'off'}`,
        `Mentions: ${s.mentionEnabled ? `on (max ${s.mentionMax} per message)` : 'off'}`,
        `Link count: ${s.linkMax > 0 ? `max ${s.linkMax} links per message` : 'off'}`,
        `Action on a hit: ${s.antispamAction}`,
        'Rate-limit spam (messages per window) is set with /automod-setup.',
      ].join('\n'))], ephemeral: true });
    }
    const { saved, settings } = await automod.setSettings(interaction.guildId, patch);
    const lines = [
      `Duplicate: ${settings.dupEnabled ? `on (same message ${settings.dupMax}× in 60s)` : 'off'}`,
      `Caps: ${settings.capsEnabled ? `on (${settings.capsPercent}%+ uppercase, ${settings.capsMinLength}+ letters)` : 'off'}`,
      `Mentions: ${settings.mentionEnabled ? `on (max ${settings.mentionMax} per message)` : 'off'}`,
      `Link count: ${settings.linkMax > 0 ? `max ${settings.linkMax} links per message` : 'off'}`,
      `Action on a hit: ${settings.antispamAction}`,
    ];
    if (!saved) lines.push('\n⚠️ MySQL is not connected — these settings are only kept in memory for this run.');
    return interaction.reply({ embeds: [successEmbed('Antispam settings saved', lines.join('\n'))], ephemeral: true });
  },
};
