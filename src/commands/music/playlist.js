const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getQueue, addTrack } = require('../../utils/musicQueue');
const playlists = require('../../utils/musicPlaylists');

function currentTracks(guildId) {
  const q = getQueue(guildId);
  if (!q) return [];
  const tracks = [];
  if (q.playing) tracks.push(q.playing);
  tracks.push(...q.queue);
  return tracks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Save, load, and manage your music playlists.')
    .addSubcommand((s) => s.setName('save').setDescription('Save the current queue as a named playlist.')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName('load').setDescription('Queue a saved playlist.')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName('list').setDescription('List your saved playlists.')
      .addUserOption((o) => o.setName('user').setDescription('Whose playlists to list (default: yours)')))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete one of your playlists.')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename one of your playlists.')
      .addStringOption((o) => o.setName('old').setDescription('Current name').setRequired(true).setMaxLength(50))
      .addStringOption((o) => o.setName('new').setDescription('New name').setRequired(true).setMaxLength(50))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Playlists need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user') || interaction.user;

    if (sub === 'list') {
      const list = await playlists.listPlaylists(interaction.guildId, target.id);
      if (!list.length) return interaction.reply({ embeds: [infoEmbed('🎵 Playlists', `${target.id === interaction.user.id ? 'You have' : `<@${target.id}> has`} no saved playlists in this server yet. Use /playlist save while something is playing.`)] });
      const lines = list.map((p) => {
        const tracks = playlists.parseTracks(p);
        return `**${p.name}** — ${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
      });
      return interaction.reply({ embeds: [infoEmbed(`🎵 ${target.id === interaction.user.id ? 'Your playlists' : `<@${target.username}>'s playlists`}`, lines.join('\n'))] });
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name');
      const result = await playlists.savePlaylist(interaction.guildId, interaction.user.id, name, currentTracks(interaction.guildId));
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not save playlist', result.error)] });
      return interaction.reply({ embeds: [successEmbed('Playlist saved', `🎵 **${name}** saved with **${result.count} tracks**.${result.updated ? ' (Updated the existing playlist with that name.)' : ''}`)] });
    }

    if (sub === 'load') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [errorEmbed('Not in voice', 'Join a voice channel first, then use /playlist load.')] });
      const name = interaction.options.getString('name');
      const row = await playlists.getPlaylist(interaction.guildId, interaction.user.id, name);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Playlist not found', `You don't have a playlist called **${name}** in this server.`)] });
      const tracks = playlists.parseTracks(row);
      if (!tracks.length) return interaction.reply({ embeds: [errorEmbed('Playlist is empty', `**${name}** has no tracks in it.`)] });
      await interaction.deferReply();
      let added = 0; let failed = 0;
      for (const t of tracks) {
        const res = await addTrack(interaction.guildId, voiceChannel, interaction.channel, t.url).catch(() => null);
        if (res?.added) added++; else failed++;
      }
      return interaction.editReply({ embeds: [added
        ? successEmbed('Playlist queued', `🎵 Queued **${added}** track${added === 1 ? '' : 's'} from **${name}**.${failed ? ` ${failed} could not be loaded.` : ''}`)
        : errorEmbed('Could not load playlist', 'None of the tracks in that playlist could be queued right now.')] });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const ok = await playlists.deletePlaylist(interaction.guildId, interaction.user.id, name);
      if (!ok) return interaction.reply({ embeds: [errorEmbed('Playlist not found', `You don't have a playlist called **${name}** in this server.`)] });
      return interaction.reply({ embeds: [successEmbed('Playlist deleted', `🗑️ **${name}** has been deleted.`)] });
    }

    // rename
    const result = await playlists.renamePlaylist(interaction.guildId, interaction.user.id, interaction.options.getString('old'), interaction.options.getString('new'));
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not rename playlist', result.error)] });
    return interaction.reply({ embeds: [successEmbed('Playlist renamed', `🎵 **${interaction.options.getString('old')}** is now **${interaction.options.getString('new')}**.`)] });
  },
};
