const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji-list')
    .setDescription('Show this server\'s custom emoji.'),
  async execute(interaction) {
    const emojis = [...interaction.guild.emojis.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!emojis.length) {
      return interaction.reply({ embeds: [infoEmbed('😀 Custom emoji', 'This server has no custom emoji yet. Add one with `/emoji-add`.')] , ephemeral: true });
    }
    const chunks = [];
    for (let i = 0; i < emojis.length; i += 25) chunks.push(emojis.slice(i, i + 25));
    const first = chunks[0];
    const fields = first.map((e) => ({ name: `:${e.name}:`, value: `${e} \`${e.id}\`${e.animated ? ' · animated' : ''}`, inline: true }));
    await interaction.reply({
      ephemeral: true,
      embeds: [infoEmbed(`😀 Custom emoji (${emojis.length})`, chunks.length > 1 ? `Showing ${first.length} of ${emojis.length} — the rest follow below.` : 'Use `/emoji-add` to add more, `/emoji-remove` to remove one.', fields)],
    });
    for (const chunk of chunks.slice(1)) {
      const moreFields = chunk.map((e) => ({ name: `:${e.name}:`, value: `${e} \`${e.id}\`${e.animated ? ' · animated' : ''}`, inline: true }));
      await interaction.followUp({ ephemeral: true, embeds: [infoEmbed('😀 Custom emoji (continued)', '', moreFields)] }).catch(() => {});
    }
  },
};
