const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const trivia = require('../../data/trivia.json');

module.exports = {
  data: new SlashCommandBuilder().setName('trivia').setDescription('Answer a random trivia question.'),
  async execute(interaction) {
    const q = trivia[Math.floor(Math.random() * trivia.length)];
    const options = [...q.options];
    // Shuffle options so the answer isn't always in the same spot.
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    const row = new ActionRowBuilder().addComponents(
      options.map((opt, i) => new ButtonBuilder()
        .setCustomId(`trivia_${i}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Primary)),
    );
    const response = await interaction.reply({ ephemeral: true,
      embeds: [infoEmbed('🧠 Trivia', `**${q.question}**\n\n${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`)],
      components: [row],
      withResponse: true,
    });
    const reply = response.resource.message;
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });
    collector.on('collect', async (btn) => {
      const picked = options[Number(btn.customId.split('_')[1])];
      const correct = picked === q.answer;
      await btn.update({
        embeds: [correct
          ? infoEmbed('🧠 Trivia', `**${q.question}**\n\n✅ **${btn.user.tag}** got it right: **${q.answer}**`)
          : errorEmbed('Trivia', `**${q.question}**\n\n❌ **${btn.user.tag}** picked **${picked}**. The answer was **${q.answer}**.`)],
        components: [],
      });
      collector.stop();
    });
    collector.on('end', async (collected) => {
      if (collected.size === 0) {
        await interaction.editReply({ embeds: [errorEmbed('Trivia', `Time's up! The answer was **${q.answer}**.`)], components: [] }).catch(() => {});
      }
    });
  },
};
