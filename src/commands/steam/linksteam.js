const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const steam = require('../../utils/steam');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linksteam')
    .setDescription('Link your Steam profile (64-bit ID, vanity name, or profile URL).')
    .addStringOption((o) => o.setName('steam').setDescription('Steam ID, vanity name, or profile URL').setRequired(true)),
  async execute(interaction) {
    if (!steam.apiKey()) return interaction.reply({ embeds: [errorEmbed('Steam not configured', 'No Steam API key is set in config.json (`steam.apiKey`). Get one free at steamcommunity.com/dev/apikey.')], ephemeral: true });
    const input = interaction.options.getString('steam');
    const steamId = await steam.resolveSteamId(input).catch(() => null);
    if (!steamId) return interaction.reply({ embeds: [errorEmbed('Could not resolve', 'That Steam profile could not be found. Use your 64-bit SteamID, vanity name, or full profile URL.')], ephemeral: true });
    const linked = await steam.linkSteam(interaction.user.id, steamId);
    if (!linked) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Linking needs MySQL — connect the database first.')], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Steam linked', `Your Steam profile is linked: https://steamcommunity.com/profiles/${steamId}`)], ephemeral: true });
  },
};
