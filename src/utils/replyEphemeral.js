// Ticket replies ephemeral (1.16.3): every reply to a ticket command is
// only visible to the user who ran it, so ticket setup/confirmations stop
// spamming the channel. The permanent record lives elsewhere (the panel
// message itself, the ticket channel, the log channel, transcripts), so
// nothing important is lost.
//
// Scope is decided in shouldForceEphemeral() — the consolidated-command
// router (src/handlers/consolidate.js) arms the wrapper ONLY for children
// of the /ticket parent, so the other 260+ commands are untouched and
// their reply behavior is byte-for-byte the same.
//
// NEVER ephemeral through this module:
// - The ticket panel embed+button posted to a channel — that goes through
//   channel.send, never interaction.reply, so it never passes the wrapper.
// - Messages posted inside ticket channels (open/close notices, claim
//   notices, transcripts) — also channel.send, never wrapped. The claim
//   / add-user / reopen button replies in ticketInteraction.js ARE the
//   in-channel notice, so they stay public too (only the clicker's
//   confirmations and error replies there are ephemeral).
// - Log posts and ghost ping callouts — channel.send, never wrapped.
// - Replies carrying buttons/select menus CAN be ephemeral — this wrapper
//   does not skip them (unlike the 1.16.2 auto-delete wrapper).
//
// Interaction with the 1.16.2 auto-delete wrapper: this wrapper must be
// armed AFTER it (see consolidate.js), so it is outermost and the flag is
// set before the auto-delete wrapper inspects the options — an ephemeral
// ticket reply is never scheduled for deletion (it already vanishes for
// everyone but the invoker). /ticket setup is in both scopes; the other
// ticket commands are only in this one.
//
// Uses `flags: MessageFlags.Ephemeral` (the 1.15.29 pattern), never the
// deprecated `ephemeral: true`. editReply is wrapped too: discord.js
// accepts flags on editReply (InteractionEditReplyOptions extends
// WebhookMessageEditOptions and MessagePayload resolves options.flags),
// and every editReply in a ticket flow follows an ephemeral defer.
const { MessageFlags } = require('discord.js');
const { isEphemeralOptions } = require('./replyAutoDelete');

// Return a copy of reply/deferReply/editReply/followUp options with the
// Ephemeral flag merged in. Handles a plain string, an options object,
// numeric flags, an array of flags, and options that are already
// ephemeral (passed through untouched). Never throws.
function withEphemeralFlag(options) {
  if (options === undefined || options === null) return { flags: MessageFlags.Ephemeral };
  if (typeof options === 'string') return { content: options, flags: MessageFlags.Ephemeral };
  if (typeof options !== 'object') return options;
  if (isEphemeralOptions(options)) return options;
  const flags = options.flags;
  if (typeof flags === 'number') return { ...options, flags: flags | MessageFlags.Ephemeral };
  if (Array.isArray(flags)) return { ...options, flags: [...flags, MessageFlags.Ephemeral] };
  return { ...options, flags: MessageFlags.Ephemeral };
}

// Scope: every child of the /ticket parent (ticket-setup, ticket-panel,
// ticket-add, ticket-remove, ticket-claim, ticket-close, ticket-ratings).
// `parentName` is the consolidated parent (e.g. 'ticket'), `child` is the
// router's child record ({ flatName }).
function shouldForceEphemeral(parentName) {
  return parentName === 'ticket';
}

// Patch one interaction's reply/deferReply/editReply/followUp so every
// reply is ephemeral. Idempotent per interaction.
function armReplyEphemeral(interaction) {
  if (!interaction || interaction.__ephemeralArmed) return;
  interaction.__ephemeralArmed = true;

  const origReply = interaction.reply.bind(interaction);
  interaction.reply = (...args) => origReply(withEphemeralFlag(args[0]));

  const origDeferReply = interaction.deferReply.bind(interaction);
  interaction.deferReply = (...args) => origDeferReply(withEphemeralFlag(args[0]));

  const origEditReply = interaction.editReply.bind(interaction);
  interaction.editReply = (...args) => origEditReply(withEphemeralFlag(args[0]));

  if (typeof interaction.followUp === 'function') {
    const origFollowUp = interaction.followUp.bind(interaction);
    interaction.followUp = (...args) => origFollowUp(withEphemeralFlag(args[0]));
  }
}

module.exports = { shouldForceEphemeral, withEphemeralFlag, armReplyEphemeral };
