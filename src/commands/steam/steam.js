const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const steam = require('../../utils/steam');

const PERSONA = { 0: 'Offline', 1: 'Online', 2: 'Busy', 3: 'Away', 4: 'Snooze', 5: 'Looking to trade', 6: 'Looking to play' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Show a Steam profile (linked account, or a Steam ID/vanity).')
    .addUserOption((o) => o.setName('user').setDescription('Discord user whose linked Steam to show'))
    .addStringOption((o) => o.setName('steam').setDescription('Steam ID, vanity name, or profile URL')),
  async execute(interaction) {
    if (!steam.apiKey()) return interaction.reply({ embeds: [errorEmbed('Steam not configured', 'No Steam API key is set in config.json (`steam.apiKey`). Get one free at steamcommunity.com/dev/apikey.')], ephemeral: true });
    let steamId = null;
    const user = interaction.options.getUser('user');
    const input = interaction.options.getString('steam');
    if (input) steamId = await steam.resolveSteamId(input).catch(() => null);
    else steamId = await steam.getLinkedSteamId(user?.id || interaction.user.id);
    if (!steamId) {
      return interaction.reply({ embeds: [errorEmbed('No Steam profile', user ? `${user.tag} has not linked a Steam profile (use /linksteam).` : 'You have not linked a Steam profile yet — use /linksteam, or pass a Steam ID/vanity to this command.')], ephemeral: true });
    }
    const profile = await steam.getPlayerSummary(steamId).catch(() => null);
    if (!profile) return interaction.reply({ embeds: [errorEmbed('Profile not found', 'Steam returned no profile for that ID.')], ephemeral: true });
    const embed = infoEmbed(`🎮 ${profile.personaname}`, [
      `**Status:** ${PERSONA[profile.personastate] || 'Unknown'}`,
      profile.gameextrainfo ? `**Currently playing:** ${profile.gameextrainfo}` : null,
      profile.loccountrycode ? `**Country:** ${profile.loccountrycode}` : null,
      `**Profile:** https://steamcommunity.com/profiles/${profile.steamid}`,
    ].filter(Boolean).join('\n'));
    if (profile.avatarfull) embed.setThumbnail(profile.avatarfull);
    return interaction.reply({ ephemeral: true, embeds: [embed] });
  },
};
