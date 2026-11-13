const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');

function applyModal(form) {
  const modal = new ModalBuilder().setCustomId(`apply_submit:${form.id}`).setTitle(`Apply — ${form.name.slice(0, 40)}`);
  form.questions.slice(0, 5).forEach((q, i) => {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`q${i}`).setLabel(q.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
    ));
  });
  return modal;
}

module.exports = {
  data: new SlashCommandBuilder().setName('apply').setDescription('Apply to join something — pick an open application form.'),
  async execute(interaction) {
    const forms = await apps.listForms(interaction.guildId, true);
    if (!forms.length) return interaction.reply({ embeds: [errorEmbed('No open applications', 'There are no open application forms in this server right now.')], ephemeral: true });
    if (forms.length === 1) return interaction.showModal(applyModal(forms[0]));
    const menu = new StringSelectMenuBuilder().setCustomId('apply_pick_form').setPlaceholder('Choose an application form')
      .addOptions(forms.map((f) => ({ label: f.name.slice(0, 100), value: String(f.id), description: (f.description || '').slice(0, 100) || undefined })));
    return interaction.reply({ embeds: [infoEmbed('Apply', 'Pick the form you want to apply with:')], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  },
  applyModal,
};
