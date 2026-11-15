const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getNowPlaying } = require('../../utils/musicQueue');

function fmtTime(totalSec) {
  if (totalSec === null || totalSec === undefined) return '—';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function progressBar(elapsed, total, length = 15) {
  if (!total) return '▬'.repeat(length);
  const filled = Math.min(length, Math.round((elapsed / total) * length));
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show what is playing now, with progress and queue info.'),
  async execute(interaction) {
    const np = getNowPlaying(interaction.guildId);
    if (!np) return interaction.reply({ embeds: [errorEmbed('Nothing playing', 'Use /play to start the music first.')] });
    const { track, elapsedSec, durationSec, queueLength, filter } = np;
    const bar = durationSec
      ? `${progressBar(elapsedSec, durationSec)}\n${fmtTime(elapsedSec)} / ${fmtTime(durationSec)}`
      : `${fmtTime(elapsedSec)} elapsed (live stream / unknown length)`;
    const requester = track.requestedBy ? `<@${track.requestedBy}>` : 'Unknown';
    return interaction.reply({
      embeds: [infoEmbed('▶️ Now playing', `**${track.title}**\n${track.url}\n\n${bar}`, [
        { name: 'Requested by', value: requester, inline: true },
        { name: 'Queue', value: `${queueLength} track(s) waiting`, inline: true },
        { name: 'Filter', value: filter === 'off' ? 'Off' : filter, inline: true },
      ])],
    });
  },
};
