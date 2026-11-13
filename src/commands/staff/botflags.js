const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');
const { getRecentFlags } = require('../../utils/botTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botflags')
    .setDescription('Staff only: list recently flagged (suspected bot) accounts.')
    .addStringOption((o) => o.setName('status').setDescription('Filter by status').addChoices({ name: 'Open', value: 'open' }, { name: 'Reviewed', value: 'reviewed' }, { name: 'Cleared', value: 'cleared' })),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bot flags are stored in MySQL (bot_flags).')], ephemeral: true });
    const status = interaction.options.getString('status');
    const rows = await getRecentFlags(interaction.guildId, 10, status);
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Bot flags', 'No flagged accounts match — clean slate. 🎉')], ephemeral: true });
    const lines = rows.map((r) => {
      const when = Math.floor(new Date(r.flagged_at).getTime() / 1000);
      return `**<@${r.user_id}>** — score **${r.score}/100** · ${r.action_taken || 'flag'} · ${r.status} · <t:${when}:R>\n${(r.reason || '').slice(0, 180)}`;
    });
    return interaction.reply({ embeds: [infoEmbed(`Bot flags (latest ${rows.length})`, `${lines.join('\n\n')}\n\nUse \`/botflag <user>\` for the full score breakdown, \`/botflag-clear <user>\` to clear a flag.`)], ephemeral: true });
  },
};
