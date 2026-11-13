const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');
const { getFlag } = require('../../utils/botTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botflag')
    .setDescription('Staff only: show one account\'s bot suspicion score breakdown.')
    .addUserOption((o) => o.setName('user').setDescription('The account to inspect').setRequired(true)),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bot flags are stored in MySQL (bot_flags).')], ephemeral: true });
    const target = interaction.options.getUser('user');
    const flag = await getFlag(interaction.guildId, target.id);
    if (!flag) return interaction.reply({ embeds: [infoEmbed('No flag', `<@${target.id}> has no bot flag on record in this server (either never scored above 40, or never joined since tracking was added).`)], ephemeral: true });
    let signals = [];
    try { signals = JSON.parse(flag.details || '[]'); } catch {}
    const lines = signals.map((s) => `• **${s.name}** (+${s.points}) — ${s.detail || ''}`);
    const when = Math.floor(new Date(flag.flagged_at).getTime() / 1000);
    return interaction.reply({ embeds: [infoEmbed(`Bot flag — ${target.tag}`, `**Score:** ${flag.score}/100 · **Action:** ${flag.action_taken || 'flag'} · **Status:** ${flag.status} · flagged <t:${when}:R>${flag.reviewed_by ? ` · reviewed by <@${flag.reviewed_by}>` : ''}\n\n${lines.join('\n') || flag.reason || 'No signal breakdown stored.'}\n\nScores are heuristics, not proof — a real new user can trip them. Clear with \`/botflag-clear ${target.id}\`.`)], ephemeral: true });
  },
};
