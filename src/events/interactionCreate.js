const { Events } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../utils/embeds');
const db = require('../utils/database');
const { fetchLogChannel } = require('../utils/logChannels');
const { isCommandEnabled } = require('../utils/featureToggles');
const { resolveChild } = require('../handlers/consolidate');
const errorLogger = require('../utils/errorLogger');

const MODERATION_COMMANDS = new Set(['kick', 'ban', 'timeout', 'warn', 'clear', 'unban']);

async function sendToLogChannel(interaction, commandName, success, errorMessage) {
  if (!MODERATION_COMMANDS.has(commandName) || !interaction.guildId) return;
  try {
    // 1.16.20: mod command usage goes to the moderation log channel — the
    // per-type channel if set, else the master log channel, else nowhere.
    const channel = await fetchLogChannel(interaction.guild, 'moderation');
    if (!channel) return;
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
      // Guarded: if the toggle lookup was slow the interaction may already
      // be expired (10062 Unknown interaction) — there is nobody left to
      // tell, so a dead reply must never throw out of the handler.
      await interaction.reply({ embeds: [errorEmbed('Disabled', why)] }).catch(() => {});
      // Log the attempt like any other execution: a disabled command used
      // to return before logCommand, so the attempt was invisible in the
      // command logs and the usage counters.
      await db.logCommand({
        guildId: interaction.guildId,
        userId: interaction.user?.id ?? 'unknown',
        username: interaction.user?.tag,
        commandName: effectiveName ?? 'unknown',
        channelId: interaction.channelId,
        success: false,
        errorMessage: `Disabled (${toggle.reason || 'disabled'})`,
      });
      return;
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
    // userId/commandName used to go in raw: logCommand() now coerces a
    // missing identity to a sentinel, but never pass undefined in the first
    // place — a missing user object must not throw here either.
    await db.logCommand({
      guildId: interaction.guildId,
      userId: interaction.user?.id ?? 'unknown',
      username: interaction.user?.tag,
      commandName: effectiveName ?? 'unknown',
      channelId: interaction.channelId,
      success,
      errorMessage,
    });
    await sendToLogChannel(interaction, effectiveName, success, errorMessage);
  },
};
