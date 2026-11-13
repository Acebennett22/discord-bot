// Handles the /rules-setup and /rules-edit modal submissions.
// (New file — event files are auto-loaded from src/events/ by
// src/handlers/eventHandler.js; no existing file was touched.)
// Modal customIds: `rules_setup_modal:<channelId>` and `rules_edit_modal`.
// Both write to the server_rules table and post/edit the single rules
// message for the guild — never a duplicate.
const { Events } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const {
  getRules, saveRules, postRules, editPostedRules,
} = require('../utils/serverRules');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;

    // --- /rules-setup modal ---
    if (interaction.customId.startsWith('rules_setup_modal:')) {
      const channelId = interaction.customId.split(':')[1];
      const title = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('rules').trim();
      const result = await postRules(interaction.guild, channelId, title, content);
      if (!result.ok) {
        return interaction.reply({ embeds: [errorEmbed('Could not post rules', `I couldn't post in <#${channelId}> — ${result.error || 'check my permissions there.'}`)], ephemeral: true });
      }
      const saved = await saveRules(interaction.guildId, {
        title, content, channelId: result.channelId, messageId: result.messageId,
      });
      const embed = successEmbed(
        result.edited ? 'Rules updated' : 'Rules posted',
        result.edited
          ? `The rules message in <#${result.channelId}> was updated in place.`
          : `The server rules are now posted in <#${result.channelId}>. Re-running /rules-setup will edit this message instead of posting a new one.`,
      );
      if (!saved) embed.addFields({ name: '⚠️ Not saved to database', value: 'MySQL is not connected — the rules are posted but will not survive a restart or be shown by /rules until the database is back.', inline: false });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /rules-edit modal ---
    if (interaction.customId === 'rules_edit_modal') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('rules').trim();
      const existing = await getRules(interaction.guildId);
      if (!existing) {
        return interaction.reply({ embeds: [errorEmbed('No rules set', 'There are no rules to edit — run /rules-setup to create them first.')], ephemeral: true });
      }
      const result = await editPostedRules(interaction.guild, { title, content });
      if (!result.ok) {
        return interaction.reply({ embeds: [errorEmbed('Could not edit rules', `I couldn't edit the posted rules message — ${result.error || 'it may have been deleted. Re-run /rules-setup to post it again.'}`)], ephemeral: true });
      }
      const saved = await saveRules(interaction.guildId, {
        title, content, channelId: existing.channelId, messageId: existing.messageId,
      });
      const embed = successEmbed('Rules updated', `The rules message in <#${existing.channelId}> was updated in place.`);
      if (!saved) embed.addFields({ name: '⚠️ Not saved to database', value: 'MySQL is not connected — the posted message was updated, but the database copy was not.', inline: false });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
