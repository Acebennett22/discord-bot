const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { filterMessages } = require('../../utils/purge');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in this channel (optionally from one user or matching text).')
    .addIntegerOption((o) => o.setName('amount').setDescription('Maximum messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user'))
    .addStringOption((o) => o.setName('contains').setDescription('Only delete messages containing this text (case-insensitive)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');
    const contains = interaction.options.getString('contains');

    if (!interaction.channel?.isTextBased?.() || typeof interaction.channel.messages?.fetch !== 'function') {
      return interaction.reply({ embeds: [errorEmbed('Purge failed', 'This command can only be used in a text channel.')], ephemeral: true });
    }

    const fetched = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) {
      return interaction.reply({ embeds: [errorEmbed('Purge failed', 'I could not read recent messages in this channel.')], ephemeral: true });
    }
    const { deletable, skippedOld, skippedPinned } = filterMessages(fetched, {
      userId: user?.id || null,
      containsText: contains || null,
    });

    if (!deletable.length) {
      const why = [
        skippedOld.length ? `${skippedOld.length} matched but ${skippedOld.length === 1 ? 'is' : 'are'} older than 14 days (Discord will not bulk-delete them)` : null,
        skippedPinned.length ? `${skippedPinned.length} matched but ${skippedPinned.length === 1 ? 'is' : 'are'} pinned` : null,
      ].filter(Boolean).join('; ');
      return interaction.reply({
        embeds: [infoEmbed('Nothing to purge', why
          ? `No matching messages could be deleted. ${why}.`
          : 'No recent messages matched the given filter.')],
        ephemeral: true,
      });
    }

    const toDelete = deletable.slice(0, amount);
    // Mark them bot-deleted first so anti-ghost-ping ignores the purge.
    const { markBotDeleted } = require('../../events/ghostPing');
    toDelete.forEach((m) => markBotDeleted(m.id));
    const deleted = await interaction.channel.bulkDelete(toDelete, true).catch(() => null);
    if (!deleted) {
      return interaction.reply({ embeds: [errorEmbed('Purge failed', 'I could not delete those messages — check my permissions in this channel.')], ephemeral: true });
    }

    // Audit log (best-effort: silently skipped if the DB is down).
    const filterDesc = [
      user ? `user:${user.id}` : null,
      contains ? `contains:${contains}` : null,
    ].filter(Boolean).join(' ') || 'all';
    await db.query(
      'INSERT INTO purge_logs (guild_id, channel_id, moderator_id, count, filter, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [interaction.guild.id, interaction.channel.id, interaction.user.id, deleted.size, filterDesc],
    ).catch(() => {});

    const skipped = [];
    if (skippedOld.length) skipped.push(`${skippedOld.length} older than 14 days`);
    if (skippedPinned.length) skipped.push(`${skippedPinned.length} pinned`);
    const skippedNote = skipped.length ? `\nSkipped: ${skipped.join(', ')} (Discord bulk-delete cannot remove them).` : '';
    const filterParts = [
      user ? `from <@${user.id}>` : null,
      contains ? `containing “${contains}”` : null,
    ].filter(Boolean);
    const filterNote = filterParts.length ? `\nFilter: messages ${filterParts.join(' and ')}.` : '';
    return interaction.reply({
      ephemeral: true,
      embeds: [successEmbed('Messages purged', `Deleted **${deleted.size}** message(s)${filterNote}.${skippedNote}`)],
    });
  },
};
