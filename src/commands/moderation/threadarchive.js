const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');
const db = require('../../utils/database');

const PRESETS = { '1h': 60, '6h': 360, '24h': 1440, '3d': 4320, '7d': 10080 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('threadarchive')
    .setDescription('Admin only: control automatic thread archiving.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('set').setDescription('Set the auto-archive duration.')
      .addIntegerOption((o) => o.setName('minutes').setDescription('Minutes of inactivity before archiving (0 = use Discord default)').setRequired(true).setMinValue(0).setMaxValue(10080))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to override (blank = server default)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the default duration and per-channel overrides.')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const settings = await getGuildSettings(interaction.guildId);
      const rows = db.isEnabled() ? await db.query('SELECT channel_id, archive_minutes FROM thread_archive_settings WHERE guild_id = ?', [interaction.guildId]) || [] : [];
      const lines = [`**Server default:** ${settings.threadArchiveMinutes} minutes`];
      if (rows.length) lines.push('', '**Per-channel overrides:**', ...rows.map((r) => `<#${r.channel_id}> — ${r.archive_minutes} minutes`));
      return interaction.reply({ embeds: [infoEmbed('🧵 Thread auto-archive', lines.join('\n'))] });
    }
    const minutes = interaction.options.getInteger('minutes');
    const channel = interaction.options.getChannel('channel');
    if (channel) {
      if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Per-channel overrides need MySQL.')] });
      await db.query(
        'INSERT INTO thread_archive_settings (guild_id, channel_id, archive_minutes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE archive_minutes = VALUES(archive_minutes)',
        [interaction.guildId, channel.id, minutes],
      );
      return interaction.reply({ embeds: [successEmbed('Thread archive override set', `🧵 Threads in <#${channel.id}> will auto-archive after **${minutes} minutes** of inactivity.`)] });
    }
    await setGuildSettings(interaction.guildId, { threadArchiveMinutes: minutes });
    return interaction.reply({ embeds: [successEmbed('Thread archive default set', `🧵 Threads will auto-archive after **${minutes} minutes** of inactivity (per-channel overrides still win).`)] });
  },
};
