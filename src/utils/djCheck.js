// DJ-role enforcement for music commands. If no DJ role is set for the guild
// (via /setup or the dashboard), anyone can use music commands.
const { PermissionsBitField } = require('discord.js');
const { getGuildSettings } = require('./guildSettings');
const { errorEmbed } = require('./embeds');

async function canUseMusic(member, guildId) {
  const settings = await getGuildSettings(guildId);
  if (!settings.djRoleId) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return member.roles.cache.has(settings.djRoleId);
}

async function requireDJ(interaction) {
  if (await canUseMusic(interaction.member, interaction.guildId)) return true;
  await interaction.reply({
    embeds: [errorEmbed('DJ only', '🎧 Only members with the DJ role (or admins) can use music commands in this server.')],
    ephemeral: true,
  }).catch(() => {});
  return false;
}

module.exports = { canUseMusic, requireDJ };
