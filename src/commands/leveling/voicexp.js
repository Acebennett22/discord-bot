const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getVoiceStats } = require('../../utils/voiceXp');
const db = require('../../utils/database');
const config = require('../../utils/config');
const { getGuildSettings } = require('../../utils/guildSettings');

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voicexp')
    .setDescription('Show voice time and voice XP earned.')
    .addUserOption((o) => o.setName('user').setDescription('Whose voice stats to show (default: you)')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Voice XP needs MySQL.')] });
    const user = interaction.options.getUser('user') || interaction.user;
    const stats = await getVoiceStats(interaction.guildId, user.id);
    const settings = await getGuildSettings(interaction.guildId);
    const rate = settings.voiceXpPerMinute ?? config.leveling?.voiceXpPerMinute ?? 2;
    return interaction.reply({
      embeds: [infoEmbed(`🎙️ Voice stats — ${user.username}`, `**Voice time:** ${fmtMinutes(stats.totalMinutes)} (${stats.totalMinutes} minutes)\n**Sessions:** ${stats.sessions}\n**Voice XP earned:** ~${stats.xp} XP\n\nVoice XP is ${rate} XP per minute in this server, only while unmuted, undeafened, and not alone in the channel.`)],
    });
  },
};
