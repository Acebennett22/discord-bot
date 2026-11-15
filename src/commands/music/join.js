const { SlashCommandBuilder } = require('discord.js');
const { joinVoice } = require('../../utils/musicQueue');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireDJ } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel without playing anything.'),
  async execute(interaction) {
    // Same DJ rule as /play: open to everyone while djOnlySkip is on (the
    // default); gated behind the DJ role only when djOnlySkip is off.
    if (!(await requireDJ(interaction, 'join'))) return;
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return interaction.reply({ embeds: [errorEmbed('Not in voice', 'Join a voice channel first, then use /music join.')] });
    await interaction.deferReply();
    const result = await joinVoice(interaction.guildId, voiceChannel, interaction.channel);
    if (!result.joined) return interaction.editReply({ embeds: [errorEmbed('Could not join', result.reason)] });
    if (result.already) return interaction.editReply({ embeds: [successEmbed('Already here', `I'm already in <#${voiceChannel.id}>.`)] });
    return interaction.editReply({ embeds: [successEmbed('Joined', `Joined <#${voiceChannel.id}>.${result.moved ? ' (Moved from the previous channel.)' : ''} Use /music play to start the music.`)] });
  },
};
