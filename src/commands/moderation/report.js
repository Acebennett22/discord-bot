const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings } = require('../../utils/guildSettings');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a user to the moderators, or list open reports.')
    .addSubcommand((s) => s.setName('submit').setDescription('Report a user to the moderators.')
      .addUserOption((o) => o.setName('user').setDescription('The user you are reporting').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('What did they do?').setRequired(true).setMaxLength(1000))
      .addStringOption((o) => o.setName('evidence').setDescription('Link to a message, screenshot, or other evidence').setMaxLength(1000)))
    .addSubcommand((s) => s.setName('list').setDescription('Mod only: list open reports in this server.')),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Reports only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so reports can\'t be filed right now.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ embeds: [errorEmbed('Mod only', 'You need the Manage Messages permission to list reports.')], ephemeral: true });
      }
      const rows = await db.query(
        "SELECT id, reporter_id, reported_id, reason, evidence, created_at FROM reports WHERE guild_id = ? AND status = 'open' ORDER BY created_at ASC LIMIT 25",
        [interaction.guildId],
      ) || [];
      if (!rows.length) {
        return interaction.reply({ embeds: [infoEmbed('Open reports', 'There are no open reports in this server.')], ephemeral: true });
      }
      const lines = rows.map((r) => {
        const when = Math.floor(new Date(r.created_at).getTime() / 1000);
        return `**#${r.id}** — <@${r.reported_id}> reported by <@${r.reporter_id}> — <t:${when}:R>\n> ${String(r.reason).slice(0, 200)}${r.evidence ? `\nEvidence: ${String(r.evidence).slice(0, 200)}` : ''}`;
      });
      const extra = rows.length === 25 ? '\n\n*(Showing the first 25.)*' : '';
      return interaction.reply({ embeds: [infoEmbed(`Open reports (${rows.length})`, `${lines.join('\n\n')}${extra}`)], ephemeral: true });
    }

    // submit
    const reported = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const evidence = interaction.options.getString('evidence') || null;
    if (reported.id === interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Can\'t report yourself', 'If you need help with your own account, please ask a moderator directly.')], ephemeral: true });
    }
    if (reported.bot) {
      return interaction.reply({ embeds: [errorEmbed('Can\'t report a bot', 'Bot issues should be raised with a moderator directly.')], ephemeral: true });
    }
    const result = await db.query(
      'INSERT INTO reports (guild_id, reporter_id, reported_id, reason, evidence) VALUES (?, ?, ?, ?, ?)',
      [interaction.guildId, interaction.user.id, reported.id, reason, evidence],
    );
    const reportId = result.insertId;

    // Post to the modlog channel, if one is set. The modlog channel is
    // configured with /modlog-setup, which writes the premium-settings key
    // (modlogChannelId); fall back to the core log channel as well.
    const settings = await getGuildSettings(interaction.guildId);
    const premium = await getPremiumSettings(interaction.guildId).catch(() => null);
    const logChannelId = premium?.modlogChannelId || settings.logChannelId || '';
    if (!logChannelId) {
      return interaction.reply({ embeds: [successEmbed('Report filed', `Your report against <@${reported.id}> was saved as **#${reportId}**.\n\n⚠️ No modlog channel is set up yet, so the moderators were **not** pinged in a channel — please ask an admin to run \`/modlog-setup\` so future reports reach the mod team.`)], ephemeral: true });
    }
    const logChannel = interaction.guild.channels.cache.get(logChannelId)
      || await interaction.guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel?.isTextBased()) {
      return interaction.reply({ embeds: [successEmbed('Report filed', `Your report against <@${reported.id}> was saved as **#${reportId}**.\n\n⚠️ The configured modlog channel could not be found, so the moderators were **not** pinged in a channel — please ask an admin to re-run \`/modlog-setup\`.`)], ephemeral: true });
    }
    await logChannel.send({
      embeds: [infoEmbed(`🚨 Report #${reportId}`, `**Reported:** <@${reported.id}> (${reported.tag})\n**Reporter:** <@${interaction.user.id}> (${interaction.user.tag})\n**Reason:** ${reason.slice(0, 1000)}${evidence ? `\n**Evidence:** ${evidence.slice(0, 1000)}` : ''}\n\nUse \`/report list\` to see open reports.`)],
    }).catch(() => null);
    return interaction.reply({ embeds: [successEmbed('Report filed', `Thanks — your report against <@${reported.id}> was sent to the moderators (report **#${reportId}**).`)], ephemeral: true });
  },
};
