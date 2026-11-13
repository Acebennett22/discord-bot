const { Events } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../utils/embeds');
const db = require('../utils/database');
const { getGuildSettings } = require('../utils/guildSettings');
const { isCommandEnabled } = require('../utils/featureToggles');
const errorLogger = require('../utils/errorLogger');

const MODERATION_COMMANDS = new Set(['kick', 'ban', 'timeout', 'warn', 'clear', 'unban']);

async function sendToLogChannel(interaction, commandName, success, errorMessage) {
  if (!MODERATION_COMMANDS.has(commandName) || !interaction.guildId) return;
  try {
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.logChannelId) return;
    const channel = interaction.guild.channels.cache.get(settings.logChannelId)
      || await interaction.guild.channels.fetch(settings.logChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({
      embeds: [infoEmbed(
        `Mod log — /${commandName}`,
        `**User:** ${interaction.user.tag} (<@${interaction.user.id}>)\n**Channel:** <#${interaction.channelId}>\n**Result:** ${success ? '✅ Success' : `❌ Failed: ${errorMessage || 'unknown error'}`}`,
      )],
    }).catch(() => {});
  } catch {}
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    const toggle = await isCommandEnabled(interaction.commandName, interaction.guildId);
    if (!toggle.enabled) {
      const why = toggle.reason === 'feature'
        ? `The **${toggle.feature}** feature is disabled${interaction.guildId ? ' in this server' : ''}.`
        : 'This command is disabled.';
      return interaction.reply({ embeds: [errorEmbed('Disabled', why)], ephemeral: true });
    }
    let success = true;
    let errorMessage = null;
    try {
      await command.execute(interaction);
    } catch (err) {
      success = false;
      errorMessage = err.message;
      await errorLogger.log({ level: 'error', guildId: interaction.guildId, commandName: interaction.commandName, userId: interaction.user.id, message: `/${interaction.commandName} failed: ${err.message}`, stack: err.stack, context: { channelId: interaction.channelId } });
      const payload = { embeds: [errorEmbed('Command error', 'Something went wrong running that command.')], ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    // Log every slash command execution (success/failure) + update counters.
    // No-ops when the DB is unavailable — commands still work.
    await db.logCommand({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      commandName: interaction.commandName,
      channelId: interaction.channelId,
      success,
      errorMessage,
    });
    await sendToLogChannel(interaction, interaction.commandName, success, errorMessage);
  },
};
