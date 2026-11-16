// Confession modal submit + approve/deny buttons (1.6.4).
// The author is only visible to staff in the review queue — never in the
// posted confession, and never in the approval buttons' public surface.
const { MessageFlags, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/database');
const { submitConfession, postConfession } = require('../utils/confessions');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Modal submit.
    if (interaction.isModalSubmit() && interaction.customId === 'confess_submit') {
      const content = interaction.fields.getTextInputValue('confession_text');
      const result = await submitConfession(interaction.client, interaction.guildId, interaction.user.id, content).catch(() => null);
      if (!result?.ok) {
        return interaction.reply({ embeds: [errorEmbed('Confession failed', result?.error || 'Something went wrong.')], flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        embeds: [successEmbed('Confession submitted', result.posted
          ? `🤫 Your confession was posted anonymously as #${result.confession.id}.`
          : `🤫 Your confession was submitted for staff review (ID #${result.confession.id}). It will be posted anonymously if approved.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    // Approve / deny buttons (staff only).
    if (interaction.isButton() && (interaction.customId.startsWith('confess_approve:') || interaction.customId.startsWith('confess_deny:'))) {
      const [kind, idStr] = interaction.customId.split(':');
      const action = kind === 'confess_approve' ? 'approve' : 'deny';
      const id = parseInt(idStr, 10);
      if (!interaction.memberPermissions?.has('ManageMessages') && !interaction.memberPermissions?.has('Administrator')) {
        return interaction.reply({ embeds: [errorEmbed('Staff only', 'Only staff can review confessions.')], flags: MessageFlags.Ephemeral });
      }
      const rows = await db.query('SELECT * FROM confessions WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
      const confession = rows?.[0];
      if (!confession) return interaction.reply({ embeds: [errorEmbed('Not found', 'That confession no longer exists.')], flags: MessageFlags.Ephemeral });
      if (confession.status !== 'pending') return interaction.reply({ embeds: [infoEmbed('Already reviewed', `Confession #${id} is already ${confession.status}.`)], flags: MessageFlags.Ephemeral });
      if (action === 'deny') {
        await db.query("UPDATE confessions SET status = 'denied', reviewed_by = ? WHERE id = ?", [interaction.user.id, id]);
        return interaction.update({ embeds: [infoEmbed('Confession denied', `Confession #${id} was denied by ${interaction.user.tag}. The author is not notified.`)], components: [] });
      }
      await db.query("UPDATE confessions SET status = 'approved', reviewed_by = ? WHERE id = ?", [interaction.user.id, id]);
      const posted = await postConfession(interaction.client, interaction.guildId, confession);
      if (!posted.ok) return interaction.reply({ embeds: [errorEmbed('Could not post', posted.error)], flags: MessageFlags.Ephemeral });
      return interaction.update({ embeds: [successEmbed('Confession approved', `Confession #${id} was posted anonymously.`)], components: [] });
    }
  },
};
