// Embed builder modals — customIds embed:create:1, embed:create:2:<channel?>,
// embed:edit:<embedId>. Step 2 picks the channel (channel select) + optional
// image/footer, then posts. Pending step-1 data is kept in memory briefly
// (5 min TTL) keyed by user id — embeds themselves are in the DB.
const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const customEmbeds = require('../utils/customEmbeds');

// userId -> { data, at }
const pending = new Map();

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Step 2: channel select for a new embed.
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('embed:create:channel:')) {
      const userId = interaction.customId.split(':')[3];
      if (interaction.user.id !== userId) return interaction.reply({ content: 'That embed builder is not yours.' });
      const entry = pending.get(userId);
      if (!entry) return interaction.reply({ embeds: [errorEmbed('Expired', 'The embed draft expired — run /embed create again.')] });
      const channelId = interaction.values[0];
      const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Bad channel', 'Pick a text channel.')] });
      const embed = customEmbeds.buildEmbedFromData(entry.data);
      const msg = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!msg) return interaction.reply({ embeds: [errorEmbed('Could not post', 'I could not send a message in that channel — check my permissions.')] });
      const id = await customEmbeds.saveEmbed(interaction.guildId, channel.id, msg.id, entry.data, interaction.user.id).catch(() => null);
      pending.delete(userId);
      return interaction.update({ content: `✅ Embed posted in <#${channel.id}> (embed #${id}). Edit it later with /embed edit.`, components: [] }).catch(() => interaction.reply({ embeds: [successEmbed('Embed posted', `Posted in <#${channel.id}> (embed #${id}).`)] }));
    }
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('embed:')) return;
    const parts = interaction.customId.split(':');
    // Create step 1 -> ask for channel (step 2).
    if (parts[1] === 'create' && parts[2] === '1') {
      const data = {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        color: interaction.fields.getTextInputValue('color') || '',
      };
      pending.set(interaction.user.id, { data, at: Date.now() });
      setTimeout(() => { const e = pending.get(interaction.user.id); if (e && Date.now() - e.at > 5 * 60_000) pending.delete(interaction.user.id); }, 5 * 60_000).unref?.();
      const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`embed:create:channel:${interaction.user.id}`)
          .setPlaceholder('Pick a channel to post in')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      );
      return interaction.reply({ content: 'Step 2 — pick the channel to post this embed in:', components: [row] });
    }
    // Edit an existing embed.
    if (parts[1] === 'edit') {
      const embedId = Number(parts[2]);
      const row = await customEmbeds.getEmbed(embedId, interaction.guildId).catch(() => null);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Not found', 'That embed no longer exists.')] });
      const data = {
        title: interaction.fields.getTextInputValue('title') || '',
        description: interaction.fields.getTextInputValue('description') || '',
        color: interaction.fields.getTextInputValue('color') || '',
        image: interaction.fields.getTextInputValue('image') || '',
        footer: interaction.fields.getTextInputValue('footer') || '',
      };
      const embed = customEmbeds.buildEmbedFromData(data);
      const channel = interaction.guild.channels.cache.get(row.channel_id) || await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
      const msg = channel?.isTextBased() ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
      if (!msg) return interaction.reply({ embeds: [errorEmbed('Message gone', 'The original embed message was deleted — I cannot edit it.')] });
      await msg.edit({ embeds: [embed] }).catch(() => null);
      await customEmbeds.updateEmbed(embedId, interaction.guildId, data).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Embed updated', `Embed #${embedId} has been updated in <#${row.channel_id}>.`)] });
    }
  },
};
