const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { requireOwner } = require('../../utils/ownerCheck');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');

function clean(text) {
  return String(text).replace(/`/g, '`\u200b').slice(0, 1900);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eval')
    .setDescription('Owner only: evaluate a JavaScript snippet. DANGEROUS — owner only for a reason.')
    .addStringOption((o) => o.setName('code').setDescription('JavaScript to evaluate').setRequired(true)),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    const code = interaction.options.getString('code');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // eslint-disable-next-line no-eval
      let result = eval(code);
      if (result instanceof Promise) result = await result;
      const output = typeof result === 'string' ? result : require('util').inspect(result, { depth: 1 });
      await interaction.editReply({ embeds: [infoEmbed('Eval result', `\`\`\`js\n${clean(output) || '(no output)'}\n\`\`\``)] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Eval error', `\`\`\`js\n${clean(err.message || err)}\n\`\`\``)] });
    }
  },
};
