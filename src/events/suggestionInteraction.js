// Handles suggestion flows: /suggest modal submit, 👍/👎 vote buttons,
// and Approve / Deny / Mark implemented review buttons.
const { MessageFlags, Events } = require('discord.js');
const sugg = require('../utils/suggestions');
const { getGuildSettings } = require('../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const db = require('../utils/database');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // --- /suggest modal submit ---
    if (interaction.isModalSubmit() && interaction.customId === 'suggest_submit') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const text = interaction.fields.getTextInputValue('details').trim();
      const settings = await getGuildSettings(interaction.guildId);
      const channelId = settings.suggestionChannelId;
      if (!channelId) {
        return interaction.reply({ embeds: [errorEmbed('Suggestions not set up', 'No suggestions channel is configured — an admin needs to run /suggestions-setup first.')] });
      }
      const channel = interaction.guild.channels.cache.get(channelId)
        || await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        return interaction.reply({ embeds: [errorEmbed('Suggestions channel unavailable', 'The configured suggestions channel could not be found — ask an admin to re-run /suggestions-setup.')] });
      }
      await interaction.deferReply();
      const id = await sugg.createSuggestion(interaction.guildId, interaction.user.id, channelId, title, text);
      const suggestion = await sugg.getSuggestion(id, interaction.guildId);
      const sent = await channel.send({
        embeds: [sugg.suggestionEmbed(suggestion)],
        components: [sugg.voteRow(id), sugg.reviewRow(id)],
      }).catch(() => null);
      if (!sent) return interaction.editReply({ embeds: [errorEmbed('Could not post', 'I could not post in the suggestions channel — check my permissions there.')] });
      await db.query('UPDATE suggestions SET message_id = ? WHERE id = ?', [sent.id, id]);
      return interaction.editReply({ embeds: [successEmbed('Suggestion posted', `Your suggestion **"${title}"** (#${id}) is live in <#${channelId}>. Use /suggest-status to track it.`)] });
    }

    // --- Vote buttons (one vote per user, changeable, toggle to remove) ---
    if (interaction.isButton() && (interaction.customId.startsWith('suggest_up:') || interaction.customId.startsWith('suggest_down:'))) {
      const [action, idRaw] = interaction.customId.split(':');
      const id = parseInt(idRaw, 10);
      const result = await sugg.castVote(id, interaction.guildId, interaction.user.id, action === 'suggest_up' ? 'up' : 'down');
      if (!result.ok) {
        return interaction.reply({ embeds: [errorEmbed('Vote failed', result.error)] });
      }
      await sugg.syncEmbed(interaction.guild, result.suggestion);
      return interaction.reply({ embeds: [successEmbed('Vote recorded', `Suggestion #${id} is now at 👍 ${result.up} · 👎 ${result.down}.`)], flags: MessageFlags.Ephemeral });
    }

    // --- Review buttons (admin or reviewer role) ---
    if (interaction.isButton() && (interaction.customId.startsWith('suggest_approve:') || interaction.customId.startsWith('suggest_deny:') || interaction.customId.startsWith('suggest_implement:'))) {
      const [action, idRaw] = interaction.customId.split(':');
      const id = parseInt(idRaw, 10);
      const settings = await getGuildSettings(interaction.guildId);
      if (!(await sugg.isReviewer(interaction.member, settings))) {
        return interaction.reply({ embeds: [errorEmbed('No permission', 'Only admins or the application reviewer role can review suggestions.')] });
      }
      const suggestion = await sugg.getSuggestion(id, interaction.guildId);
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Not found', 'That suggestion no longer exists.')] });
      const decision = action === 'suggest_approve' ? 'approved' : action === 'suggest_deny' ? 'denied' : 'implemented';
      const result = await sugg.reviewSuggestion(interaction.guild, suggestion, decision, interaction.user);
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Already reviewed', result.error)] });
      return interaction.reply({ embeds: [successEmbed(`Suggestion ${decision}`, `Suggestion #${id} — **${suggestion.title}** — was marked **${decision}**. The suggester has been DMed.`)] });
    }
  },
};
