const { Events } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../utils/embeds');
const db = require('../utils/database');
const { getGuildSettings } = require('../utils/guildSettings');
const { isCommandEnabled } = require('../utils/featureToggles');
const { resolveChild } = require('../handlers/consolidate');
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
    // Autocomplete: route through the same subcommand lookup to the child's
    // autocomplete handler (e.g. /economy job). Previously nothing handled
    // autocomplete interactions at all, so job autocomplete was dead.
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      const target = command.isParent ? resolveChild(command, interaction)?.module : command;
      if (target?.autocomplete) {
        try {
          await target.autocomplete(interaction);
        } catch (err) {
          await errorLogger.log({ level: 'error', guildId: interaction.guildId, commandName: interaction.commandName, userId: interaction.user.id, message: `Autocomplete for /${interaction.commandName} failed: ${err.message}`, stack: err.stack }).catch(() => {});
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    // Consolidated commands (1.15.0): toggles, mod logging, and command
    // logging are keyed by the FLAT child name, so resolve it first.
    const effectiveName = resolveChild(command, interaction)?.flatName || interaction.commandName;
    const toggle = await isCommandEnabled(effectiveName, interaction.guildId);
    if (!toggle.enabled) {
      const why = toggle.reason === 'feature'
        ? `The **${toggle.feature}** feature is disabled${interaction.guildId ? ' in this server' : ''}.`
        : 'This command is disabled.';
      return interaction.reply({ embeds: [errorEmbed('Disabled', why)] });
    }
    let success = true;
    let errorMessage = null;
    try {
      await command.execute(interaction);
    } catch (err) {
      success = false;
      errorMessage = err.message;
      await errorLogger.log({ level: 'error', guildId: interaction.guildId, commandName: effectiveName, userId: interaction.user.id, message: `/${effectiveName} failed: ${err.message}`, stack: err.stack, context: { channelId: interaction.channelId } });
      const payload = { embeds: [errorEmbed('Command error', 'Something went wrong running that command.')] };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    // Log every slash command execution (success/failure) + update counters.
    // No-ops when the DB is unavailable — commands still work.
    await db.logCommand({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      commandName: effectiveName,
      channelId: interaction.channelId,
      success,
      errorMessage,
    });
    await sendToLogChannel(interaction, effectiveName, success, errorMessage);
  },
};
