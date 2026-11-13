// DJ-mode enforcement for music commands (v1.11.1).
// DJ mode is OFF by default — when off, everyone can use every music command.
// When ON (and a DJ role is set), the control commands — skip, stop, pause,
// resume, filter, queue-clear — require the DJ role (or admin).
// /play, /lyrics, /queue and /nowplaying stay open to everyone while
// djOnlySkip is on (the default); turning djOnlySkip OFF gates every music
// command behind the DJ role instead.
const { PermissionsBitField } = require('discord.js');
const { getGuildSettings } = require('./guildSettings');
const { errorEmbed } = require('./embeds');

const DJ_ONLY_COMMANDS = ['skip', 'stop', 'pause', 'resume', 'filter', 'queue-clear'];

async function canUseMusic(member, guildId, commandName) {
  const settings = await getGuildSettings(guildId);
  if (!settings.djEnabled) return true;
  if (!settings.djRoleId) return true;
  if (settings.djOnlySkip && !DJ_ONLY_COMMANDS.includes(commandName)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return member.roles.cache.has(settings.djRoleId);
}

async function requireDJ(interaction, commandName) {
  if (await canUseMusic(interaction.member, interaction.guildId, commandName)) return true;
  const settings = await getGuildSettings(interaction.guildId);
  const role = interaction.guild?.roles.cache.get(settings.djRoleId);
  await interaction.reply({
    embeds: [errorEmbed('DJ only', `🎧 DJ mode is on — only members with the ${role ? `<@&${role.id}>` : 'DJ'} role (or admins) can use \`/${commandName}\` in this server.`)],
    ephemeral: true,
  }).catch(() => {});
  return false;
}

module.exports = { canUseMusic, requireDJ, DJ_ONLY_COMMANDS };
