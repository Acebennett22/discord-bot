const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { parseDuration, getExpiry, recordTempban, getActiveTempban } = require('../../utils/tempban');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a member — they are auto-unbanned when the duration ends.')
    .addUserOption((o) => o.setName('user').setDescription('Member to tempban').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('How long: e.g. 12h, 7d, 2w, 30d').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the tempban'))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    const ms = parseDuration(durationStr);
    if (ms === null) {
      return interaction.reply({ embeds: [errorEmbed('Tempban failed', 'Invalid duration. Use a number plus a unit, e.g. `12h`, `7d`, `2w`, `30d`.')] });
    }
    const expiresAt = getExpiry(durationStr);

    if (user.id === interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Tempban failed', 'You cannot tempban yourself.')] });
    }
    if (user.id === interaction.guild.ownerId) {
      return interaction.reply({ embeds: [errorEmbed('Tempban failed', 'You cannot tempban the server owner.')] });
    }

    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const invoker = interaction.member;
      // Role hierarchy: the target must be strictly below the invoker,
      // unless the invoker is the server owner.
      if (interaction.user.id !== interaction.guild.ownerId
        && member.roles.highest.position >= invoker.roles.highest.position) {
        return interaction.reply({ embeds: [errorEmbed('Tempban failed', 'That member has a higher or equal top role than you.')] });
      }
      if (!member.bannable) {
        return interaction.reply({ embeds: [errorEmbed('Tempban failed', 'I cannot ban that member — check my role position and permissions.')] });
      }
    }

    const existing = await getActiveTempban(interaction.guild.id, user.id).catch(() => null);
    if (existing) {
      return interaction.reply({ embeds: [errorEmbed('Tempban failed', `**${user.tag}** is already tempbanned until <t:${Math.floor(new Date(existing.expires_at).getTime() / 1000)}:F>. Use /tempban-cancel first to change it.`)] });
    }

    await interaction.guild.members.ban(user.id, { reason: `Tempban (${durationStr}): ${reason}`, deleteMessageDays: deleteDays });
    const recordId = await recordTempban(interaction.guild.id, user.id, interaction.user.id, reason, expiresAt).catch(() => null);

    const expiryTs = Math.floor(expiresAt.getTime() / 1000);
    const dbNote = recordId === null
      ? '\n\n⚠️ The ban is in place, but the database was unavailable so the expiry was **not recorded** — this user will NOT be auto-unbanned. Re-run the command (or unban manually) once the database is back.'
      : '';
    return interaction.reply({
      
      embeds: [successEmbed('Member tempbanned', `**${user.tag}** was banned until <t:${expiryTs}:F> (<t:${expiryTs}:R>).\nReason: ${reason}${dbNote}`)],
    });
  },
};
