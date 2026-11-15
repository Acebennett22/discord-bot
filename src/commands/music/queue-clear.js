const { SlashCommandBuilder } = require('discord.js');
const { getQueue, clearQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('queue-clear').setDescription('Clear all upcoming songs from the queue (current song keeps playing).'),
  async execute(interaction) {
    if (!(await requireDJ(interaction, 'queue-clear'))) return;
    const queue = getQueue(interaction.guildId);
    if (!queue || (queue.queue.length === 0 && !queue.playing)) {
      return interaction.reply({ embeds: [errorEmbed('Queue is empty', 'There is nothing in the queue to clear.')] });
    }
    const cleared = clearQueue(interaction.guildId);
    return interaction.reply({  embeds: [successEmbed('Queue cleared', `🧹 Removed **${cleared}** upcoming song${cleared === 1 ? '' : 's'} from the queue. The current song keeps playing.`)] });
  },
};
