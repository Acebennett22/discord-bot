const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const reengage = require('../../utils/reengage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reengage-optout')
    .setDescription('Stop (or resume) receiving "we miss you" messages from this server.')
    .addStringOption((o) => o.setName('choice').setDescription('Opt out or opt back in').setRequired(true)
      .addChoices({ name: 'Opt out (stop the messages)', value: 'out' }, { name: 'Opt back in', value: 'in' })),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Re-engagement needs MySQL.')] });
    const optOut = interaction.options.getString('choice') === 'out';
    await reengage.setOptOut(interaction.guildId, interaction.user.id, optOut);
    return interaction.reply({ embeds: [optOut
      ? successEmbed('Opted out', 'You will no longer receive re-engagement messages in this server. You can opt back in any time with /reengage-optout.')
      : successEmbed('Opted back in', 'You may receive a "we miss you" message again if you go inactive for a while.')]
       });
  },
};
