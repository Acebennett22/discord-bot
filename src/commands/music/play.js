const { SlashCommandBuilder } = require('discord.js');
const { addTrack, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song (YouTube search/URL, or a Spotify track link).')
    .addStringOption((o) => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),
  async execute(interaction) {
    if (!(await requireDJ(interaction, 'play'))) return;
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return interaction.reply({ embeds: [errorEmbed('Not in voice', 'Join a voice channel first, then use /play.')], ephemeral: true });
    const query = interaction.options.getString('query');
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await addTrack(interaction.guildId, voiceChannel, interaction.channel, query);
      if (!result.added) return interaction.editReply({ embeds: [errorEmbed('Could not play', result.reason)] });
      result.track.requestedBy = interaction.user.id;
      const queue = getQueue(interaction.guildId);
      const nowPlaying = queue.playing && queue.playing.url === result.track.url;
      return interaction.editReply({ embeds: [successEmbed(nowPlaying ? 'Now playing' : 'Added to queue', `**${result.track.title}**\n${result.track.url}${nowPlaying ? '' : `\nPosition in queue: ${result.position}`}${result.spotifyNote ? `\n\n_${result.spotifyNote}_` : ''}`)] });
    } catch (err) {
      console.error('[play]', err);
      return interaction.editReply({ embeds: [errorEmbed('Playback error', 'Could not load that track. Try a different song or URL.')] });
    }
  },
};
