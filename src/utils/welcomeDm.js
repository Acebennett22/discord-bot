// Welcome DM (1.9.3): DM new members a per-guild welcome message on join.
// Placeholders: {user} (mention), {username}, {server}.
// Settings live in guild_settings (welcome_dm_enabled, welcome_dm_message)
// — see the 1.9.3 integration notes: until those columns/DEFAULTS entries
// exist, getGuildSettings() returns undefined for both and this stays off.
// DMs closed (error code 50007) or any other send failure is logged and
// skipped silently — never throws, never breaks the join flow.
const { infoEmbed } = require('./embeds');
const { getGuildSettings } = require('./guildSettings');
const { formatMessage } = require('./welcome');
const { logWarn } = require('./errorLogger');

async function sendWelcomeDm(member) {
  try {
    const settings = await getGuildSettings(member.guild.id);
    if (!settings.welcomeDmEnabled) return { sent: false, reason: 'disabled' };
    if (!settings.welcomeDmMessage) return { sent: false, reason: 'no message set' };
    const text = formatMessage(settings.welcomeDmMessage, member);
    const embed = infoEmbed(`👋 Welcome to ${member.guild.name}!`, text);
    await member.send({ embeds: [embed] });
    return { sent: true };
  } catch (err) {
    // 50007 = "Cannot send messages to this user" (DMs closed/blocked).
    // Either way: skip silently, log, never break the join flow.
    await logWarn('welcome-dm: could not DM new member', {
      guildId: member.guild.id,
      userId: member.id,
      error: err.code === 50007 ? 'DMs closed (50007)' : err.message,
    });
    return { sent: false, reason: err.code === 50007 ? 'DMs closed' : err.message };
  }
}

module.exports = { sendWelcomeDm };
