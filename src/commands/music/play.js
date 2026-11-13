const { SlashCommandBuilder } = require('discord.js');
const { addTrack, getQueue } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song in your voice channel (YouTube URL or search).')
    .addStringOption((o) => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),
  async execute(interaction) {
    if (!(await requireDJ(interaction))) return;
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return interaction.reply({ embeds: [errorEmbed('Not in voice', 'Join a voice channel first, then use /play.')], ephemeral: true });
    const query = interaction.options.getString('query');
    await interaction.deferReply();
    try {
      const result = await addTrack(interaction.guildId, voiceChannel, interaction.channel, query);
      if (!result.added) return interaction.editReply({ embeds: [errorEmbed('Could not play', result.reason)] });
      const queue = getQueue(interaction.guildId);
      const nowPlaying = queue.playing && queue.playing.url === result.track.url;
      return interaction.editReply({ embeds: [successEmbed(nowPlaying ? 'Now playing' : 'Added to queue', `**${result.track.title}**\n${result.track.url}${nowPlaying ? '' : `\nPosition in queue: ${result.position}`}`)] });
    } catch (err) {
      console.error('[play]', err);
      return interaction.editReply({ embeds: [errorEmbed('Playback error', 'Could not load that track. Try a different song or URL.')] });
    }
  },
};
