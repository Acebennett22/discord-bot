const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { addWarn, getWarns } = require('../../utils/warns');
const { getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member, or list their warnings.')
    .addSubcommand((s) => s.setName('add').setDescription('Add a warning to a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List a member\'s warnings.')
      .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (sub === 'add') {
      const reason = interaction.options.getString('reason');
      const warns = addWarn(interaction.guildId, user.id, { reason, moderator: interaction.user.tag });
      // Auto-action: if the guild set a warn threshold (dashboard / /setup),
      // apply it once the count is reached.
      let actionNote = '';
      const settings = await getGuildSettings(interaction.guildId);
      if (settings.warnThreshold && warns.length >= settings.warnThreshold && settings.warnAction) {
        const member = interaction.guild.members.cache.get(user.id)
          || await interaction.guild.members.fetch(user.id).catch(() => null);
        try {
          if (settings.warnAction === 'timeout' && member?.moderatable) {
            await member.timeout(10 * 60_000, `Reached ${warns.length} warnings`);
            actionNote = `\n⚠️ Warn threshold reached (${warns.length}/${settings.warnThreshold}) — member timed out for 10 minutes.`;
          } else if (settings.warnAction === 'kick' && member?.kickable) {
            await member.kick(`Reached ${warns.length} warnings`);
            actionNote = `\n⚠️ Warn threshold reached (${warns.length}/${settings.warnThreshold}) — member kicked.`;
          } else if (settings.warnAction === 'ban' && member?.bannable) {
            await interaction.guild.members.ban(user.id, { reason: `Reached ${warns.length} warnings` });
            actionNote = `\n⚠️ Warn threshold reached (${warns.length}/${settings.warnThreshold}) — member banned.`;
          }
        } catch (err) { actionNote = `\n⚠️ Warn threshold reached, but the auto-action failed: ${err.message}`; }
      }
      return interaction.reply({ ephemeral: true, embeds: [successEmbed('Member warned', `**${user.tag}** was warned.\nReason: ${reason}\nThey now have **${warns.length}** warning(s).${actionNote}`)] });
    }
    const warns = getWarns(interaction.guildId, user.id);
    if (!warns.length) return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Warnings', `**${user.tag}** has no warnings.`)] });
    const lines = warns.map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.moderator} (${new Date(w.date).toLocaleString()})`);
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed(`Warnings for ${user.tag} (${warns.length})`, lines.join('\n'))] });
  },
};
