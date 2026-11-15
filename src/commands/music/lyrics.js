const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getQueue } = require('../../utils/musicQueue');
const { fetchLyrics, splitArtistTitle } = require('../../utils/lyrics');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Show lyrics for the song playing now, or a song you name.')
    .addStringOption((o) => o.setName('song').setDescription('Song to look up, as "Artist - Title"')),
  async execute(interaction) {
    if (!(await requireDJ(interaction, 'lyrics'))) return;
    let artist = null;
    let title = null;
    const named = interaction.options.getString('song');
    if (named) {
      const split = splitArtistTitle(named);
      if (!split) return interaction.reply({ embeds: [errorEmbed('Need artist and title', 'Use the format `Artist - Title`, e.g. `/lyrics song: Queen - Bohemian Rhapsody`.')] });
      ({ artist, title } = split);
    } else {
      const queue = getQueue(interaction.guildId);
      if (!queue?.playing) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'Play something first, or name a song: `/lyrics song: Artist - Title`.')] });
      const split = splitArtistTitle(queue.playing.title);
      if (!split) return interaction.reply({ embeds: [errorEmbed('Can\'t tell the artist', `The current track title ("${queue.playing.title}") has no "Artist - Title" split. Name the song instead.`)] });
      ({ artist, title } = split);
    }
    await interaction.deferReply();
    const result = await fetchLyrics(artist, title);
    if (result.error) return interaction.editReply({ embeds: [errorEmbed('No lyrics', result.error)] });
    const text = result.lyrics.length > 4000 ? `${result.lyrics.slice(0, 4000)}\n…` : result.lyrics;
    return interaction.editReply({ embeds: [infoEmbed(`🎤 ${artist} — ${title}`, text)] });
  },
};
