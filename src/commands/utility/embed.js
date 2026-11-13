const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const customEmbeds = require('../../utils/customEmbeds');

function parseMessageRef(ref) {
  // Accepts a message ID or a discord.com message link.
  const link = /discord\.com\/channels\/\d+\/(\d+)\/(\d+)/.exec(ref || '');
  if (link) return { channelId: link[1], messageId: link[2] };
  if (/^\d{17,20}$/.test((ref || '').trim())) return { channelId: null, messageId: ref.trim() };
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build and edit bot-posted embeds.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('create').setDescription('Admin: build an embed and post it to a channel.'))
    .addSubcommand((s) => s.setName('edit').setDescription('Admin: edit an existing bot-posted embed.')
      .addStringOption((o) => o.setName('message').setDescription('Message ID or message link of the bot embed').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Admin: list embeds the bot has built in this server.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Embed builder needs MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await customEmbeds.listEmbeds(interaction.guildId, 25);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🧩 Embeds', 'No embeds built yet. Use /embed create.')], ephemeral: true });
      const lines = rows.map((r) => {
        let data = {};
        try { data = JSON.parse(r.embed_json); } catch {}
        return `**#${r.id}** — ${data.title || '(no title)'} — <#${r.channel_id}> — [jump](https://discord.com/channels/${interaction.guildId}/${r.channel_id}/${r.message_id})`;
      });
      return interaction.reply({ embeds: [infoEmbed('🧩 Built embeds', `${lines.join('\n')}\n\nEdit one with /embed edit <message link>.`)], ephemeral: true });
    }
    if (sub === 'edit') {
      const ref = parseMessageRef(interaction.options.getString('message'));
      if (!ref) return interaction.reply({ embeds: [errorEmbed('Bad reference', 'Give a message ID or a full Discord message link.')], ephemeral: true });
      const row = await customEmbeds.getEmbedByMessage(interaction.guildId, ref.messageId);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Not found', 'That message is not one of the embeds this bot built (or it is in another server).')], ephemeral: true });
      const data = row.data || {};
      const modal = new ModalBuilder().setCustomId(`embed:edit:${row.id}`).setTitle('Edit embed');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue((data.title || '').slice(0, 256))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue((data.description || '').slice(0, 4000))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(data.color || '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.image || '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer text (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setValue(data.footer || '')),
      );
      return interaction.showModal(modal);
    }
    // create — step 1 modal (title/description/color), step 2 in the event handler.
    const modal = new ModalBuilder().setCustomId('embed:create:1').setTitle('Build an embed (1/2)');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setPlaceholder('#5865F2')),
    );
    return interaction.showModal(modal);
  },
};
