const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../../utils/musicQueue');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue.'),
  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || (!queue.playing && !queue.queue.length)) {
      return interaction.reply({ embeds: [errorEmbed('Queue is empty', 'Nothing is playing. Use /play to add a song.')], ephemeral: true });
    }
    const lines = [];
    if (queue.playing) lines.push(`▶️ **Now playing:** ${queue.playing.title}`);
    queue.queue.slice(0, 10).forEach((t, i) => lines.push(`**${i + 1}.** ${t.title}`));
    if (queue.queue.length > 10) lines.push(`…and ${queue.queue.length - 10} more.`);
    return interaction.reply({ embeds: [infoEmbed('Music queue', lines.join('\n'))] });
  },
};
