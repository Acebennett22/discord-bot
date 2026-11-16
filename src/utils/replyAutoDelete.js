// Reply auto-delete (1.16.2): the bot's public reply to a moderation or
// setup command deletes itself after 60 seconds, so channels stay clean.
// The permanent record lives elsewhere (member log, modlog, Automod log,
// dashboard Staff Errors, MySQL), so nothing important is lost.
//
// Scope is decided in shouldAutoDeleteReply() — the consolidated-command
// router (src/handlers/consolidate.js) arms the wrapper ONLY for in-scope
// commands, so the other 250+ commands are untouched and their reply
// behavior is byte-for-byte the same.
//
// NEVER deleted by this module:
// - Log posts (memberLog.js, messageLog.js, Automod log, interactionCreate's
//   "Mod log" post) — those go through channel.send, never interaction.reply.
// - Ghost ping callouts (ghostPing.js) — also channel.send, never wrapped.
// - Replies with live interactive components (buttons, select menus) — a
//   setup wizard or confirmation prompt must stay clickable. Checked both
//   when the reply lands AND when the timer fires, in case the command
//   edits components onto the reply afterwards.
// - Ephemeral replies — they already vanish for the user; left alone.
// - followUp() messages — only the main reply is ever scheduled, never a
//   follow-up carrying data.
//
// The timer is unref'd (like the other timers in the codebase, e.g.
// ghostPing.js) so it never keeps the process alive on shutdown, and a
// delete that fails (message already gone, channel deleted) is swallowed.
const { MessageFlags } = require('discord.js');

const AUTO_DELETE_DELAY_MS = 60_000;

function isEphemeralOptions(options) {
  if (!options || typeof options !== 'object') return false;
  if (options.ephemeral === true) return true;
  const flags = options.flags;
  if (typeof flags === 'number') return (flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
  if (Array.isArray(flags)) return flags.includes(MessageFlags.Ephemeral);
  return false;
}

function hasComponents(message) {
  return Array.isArray(message?.components) && message.components.length > 0;
}

// Schedule one already-sent message for deletion. Never throws.
function scheduleMessageDeletion(message, delayMs = AUTO_DELETE_DELAY_MS) {
  if (!message || typeof message.delete !== 'function') return false;
  if (hasComponents(message)) return false;
  const timer = setTimeout(() => {
    // Re-check components at fire time: the command may have edited
    // buttons/selects onto the reply after we captured it.
    Promise.resolve()
      .then(() => (typeof message.fetch === 'function' ? message.fetch() : message))
      .then((fresh) => {
        if (!fresh || hasComponents(fresh)) return;
        return fresh.delete().catch(() => {});
      })
      .catch(() => {});
  }, delayMs);
  timer.unref?.();
  return true;
}

// Scope: moderation commands (every child of the /mod parent) and setup
// commands (any flat command named *-setup, or any invoked subcommand
// named 'setup' — e.g. /utility setup, /mod logging setup, /fun
// trivia-daily setup). `parentName` is the consolidated parent (e.g.
// 'mod', 'ticket'), `child` is the router's child record ({ flatName }),
// and the subcommand is read off the interaction when present.
function shouldAutoDeleteReply(parentName, child, interaction) {
  if (parentName === 'mod') return true;
  const flatName = child?.flatName || '';
  if (flatName.endsWith('-setup')) return true;
  try {
    if (interaction?.options?.getSubcommand?.(false) === 'setup') return true;
  } catch {}
  return false;
}

// Patch one interaction's reply/deferReply/editReply so the FIRST
// content-bearing public reply is scheduled for deletion. Idempotent per
// interaction; followUp() is deliberately NOT patched. A reply that is
// ephemeral, or that carries components, is never scheduled.
function armReplyAutoDelete(interaction) {
  if (!interaction || interaction.__autoDeleteArmed) return;
  interaction.__autoDeleteArmed = true;
  let scheduled = false;
  let deferredEphemeral = false;

  const scheduleOnce = (message) => {
    if (scheduled) return;
    if (scheduleMessageDeletion(message)) scheduled = true;
  };

  const origReply = interaction.reply.bind(interaction);
  interaction.reply = async (...args) => {
    const options = args[0];
    // Ephemeral replies vanish on their own — pass through untouched.
    if (isEphemeralOptions(options)) return origReply(...args);
    // Ask discord.js for the sent message so we can delete it later.
    // (Children ignore reply()'s return value — interactionCreate awaits
    // command.execute() and discards it — so this is behavior-preserving.)
    const opts = (options && typeof options === 'object')
      ? { ...options, fetchReply: true }
      : { content: options, fetchReply: true };
    const message = await origReply(opts);
    scheduleOnce(message);
    return message;
  };

  const origDeferReply = interaction.deferReply.bind(interaction);
  interaction.deferReply = async (...args) => {
    if (isEphemeralOptions(args[0])) deferredEphemeral = true;
    return origDeferReply(...args);
  };

  const origEditReply = interaction.editReply.bind(interaction);
  interaction.editReply = async (...args) => {
    const message = await origEditReply(...args);
    // An ephemeral deferred reply is user-only; leave it alone.
    if (!deferredEphemeral) scheduleOnce(message);
    return message;
  };
}

module.exports = {
  AUTO_DELETE_DELAY_MS,
  isEphemeralOptions,
  hasComponents,
  scheduleMessageDeletion,
  shouldAutoDeleteReply,
  armReplyAutoDelete,
};
