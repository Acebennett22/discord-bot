// Safety status (1.14.6): one command showing the server's whole
// protection state at a glance — which systems are on or off, how many
// rules/responses/roles are configured, and how many Automod actions
// fired in the last 24 hours. Read-only; it changes nothing.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const automod = require('../../utils/automod');
const contentFilter = require('../../utils/contentFilter');
const memberLog = require('../../utils/memberLog');
const { resolveLogChannel } = require('../../utils/logChannels');
const { getRules: getAutoresponders } = require('../../utils/autoresponders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('safety-status')
    .setDescription('Admin only: show the server\'s protection state — what\'s on, what\'s off, recent actions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Safety status only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'Protection settings live in MySQL — connect the database first.')] });
    const [am, filterRules, logging, responders, amLogChannelId, memberLogChannelId] = await Promise.all([
      automod.getSettings(interaction.guildId),
      contentFilter.getRules(interaction.guildId),
      memberLog.getSettings(interaction.guildId),
      getAutoresponders(interaction.guildId),
      // 1.16.20: effective log channels (per-type, else master).
      resolveLogChannel(interaction.guildId, 'automod'),
      resolveLogChannel(interaction.guildId, 'member'),
    ]);
    const rrRows = await db.query('SELECT COUNT(DISTINCT message_id) AS c, COUNT(*) AS total FROM reaction_roles WHERE guild_id = ?', [interaction.guildId]).catch(() => []);
    const streamRows = await db.query('SELECT COUNT(*) AS c FROM streamers WHERE guild_id = ?', [interaction.guildId]).catch(() => []);
    const actionRows = await db.query(
      "SELECT action, COUNT(*) AS c FROM automod_actions WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY action",
      [interaction.guildId],
    ).catch(() => []);
    const totalActions = (actionRows || []).reduce((n, r) => n + Number(r.c || 0), 0);
    const actionLine = totalActions
      ? (actionRows || []).map((r) => `${r.action} ×${r.c}`).join(', ')
      : 'none in the last 24h';

    const onOff = (on) => (on ? '✅ on' : '❌ off');
    const words = (filterRules || []).filter((r) => r.type === 'word').length;
    const domains = (filterRules || []).filter((r) => r.type === 'domain').length;
    const liveResponders = (responders || []).filter((r) => r.enabled).length;
    const logEvents = [
      ['Joins', logging.logJoins], ['Leaves', logging.logLeaves], ['Bans', logging.logBans],
      ['Kicks', logging.logKicks], ['Timeouts', logging.logTimeouts], ['Role changes', logging.logRoleChanges],
    ].filter(([, on]) => on).map(([label]) => label);

    const lines = [
      `**Automod:** ${onOff(am.enabled)} — spam ${am.spamMaxMessages}+/${am.spamWindowSeconds}s → ${am.spamAction}; links ${onOff(am.blockLinks)}, invites ${onOff(am.blockInvites)}; banned words: ${am.bannedWords.length}; log: ${amLogChannelId ? `<#${amLogChannelId}>` : 'not set'}`,
      `**Antispam:** duplicates ${onOff(am.dupEnabled)}, caps ${onOff(am.capsEnabled)}, mentions ${onOff(am.mentionEnabled)}, link limit ${am.linkMax > 0 ? `max ${am.linkMax}` : 'off'} — action: ${am.antispamAction}`,
      `**Content filter:** ${words} blocked word(s), ${domains} blocked domain(s)`,
      `**Member logging:** ${memberLogChannelId ? `<#${memberLogChannelId}> — ${logEvents.length ? logEvents.join(', ') : 'all events off'}` : 'not set up (run /logging setup)'}`,
      `**Autoresponders:** ${liveResponders}/${(responders || []).length} enabled`,
      `**Reaction roles:** ${Number(rrRows?.[0]?.total || 0)} mapping(s) on ${Number(rrRows?.[0]?.c || 0)} message(s)`,
      `**Stream watchers:** ${Number(streamRows?.[0]?.c || 0)} (Twitch/YouTube/Kick auto-check; TikTok/Facebook manual via /stream-announce)`,
      `**Automod actions (24h):** ${totalActions} — ${actionLine}`,
    ];
    return interaction.reply({ embeds: [statsEmbed(`🛡️ Safety status — ${interaction.guild.name}`, lines.join('\n\n'))] });
  },
};
