// Consolidation (1.15.0, breaking change): Discord caps an app at 100 top-level
// CHAT_INPUT commands per scope, and this bot has 266 flat slash commands.
// The 266 command files are NOT edited — grouping happens here, at the JSON
// level, and routing happens through a parent execute() that looks up the
// original child module. /ban becomes /mod ban, /play becomes /music play.
//
// Structure: one parent per folder (utility splits in two), standalone
// commands that already have subcommands stay top-level (serverbackup,
// giveaway, mediathreads), and the two MESSAGE context-menu commands stay
// standalone. Children that already define subcommands become SUBCOMMAND
// GROUPs under their parent (their own getSubcommand() calls still work);
// plain children become SUBCOMMANDs.
//
// Permissions: a child's default_member_permissions cannot live on a
// subcommand. If every child in a parent shares one value it is set on the
// parent; otherwise the parent stays open and the router enforces each
// child's original permission at runtime before calling its execute().
const fs = require('fs');
const path = require('path');
const { errorEmbed } = require('../utils/embeds');

// folder -> parent command name. null = keep each file as its own top-level
// command (those files already define subcommands of their own).
const PARENT_MAP = {
  admin: null, // serverbackup
  ai: 'ai',
  applications: 'application',
  automod: 'automod',
  birthdays: 'birthday',
  casino: 'casino',
  counting: 'counting',
  customcommands: 'custom',
  economy: 'economy',
  emojis: 'emoji',
  faq: 'faq',
  fun: 'fun',
  gameservers: 'gameserver',
  giveaways: null, // giveaway
  invites: 'invite',
  leveling: 'level',
  media: null, // mediathreads
  moderation: 'mod',
  modmail: 'modmail',
  music: 'music',
  owner: 'owner',
  reactionroles: 'reactionroles',
  roles: 'role',
  staff: 'staff',
  starboard: 'starboard',
  steam: 'steam',
  streams: 'stream',
  suggestions: 'suggest',
  tempvc: 'tempvc',
  tickets: 'ticket',
  utility: 'utility', // split in two — see UTILITY_TOOLS
  verification: 'verify',
  weather: 'weather',
  welcome: 'welcome',
};

// utility/ has 46 chat commands — too many for one parent (25 max). These
// go to the `tools` parent (posting, scheduling, automation); the rest stay
// under `utility` (info, stats, setup). Both end up at or under the cap.
const UTILITY_TOOLS = new Set([
  'afk', 'afk-list', 'afk-remove',
  'announce', 'autopublish', 'autorole', 'autoresponder',
  'bookmark', 'event',
  'poll', 'poll-end', 'poll-results',
  'reengage-optout', 'reengage-preview', 'reengage-setup',
  'remind', 'remindme',
  'rules', 'rules-edit', 'rules-setup',
  'schedule', 'schedule-cancel', 'schedule-list',
  'translate', 'translate-setup',
]);

const PARENT_DESCRIPTIONS = {
  ai: 'Ask the AI and manage AI chat settings.',
  application: 'Manage server applications and submissions.',
  automod: 'Configure automatic moderation and filters.',
  birthday: 'Set birthdays and birthday announcements.',
  casino: 'Casino games — slots, blackjack, roulette and more.',
  counting: 'Counting game and bump settings.',
  custom: 'Create custom auto-response commands.',
  economy: 'Money, jobs, shop, and trading.',
  emoji: 'Manage server emoji.',
  faq: 'Frequently asked questions and answers.',
  fun: 'Fun commands, games, and social actions.',
  gameserver: 'Check game server status and manage servers.',
  invite: 'Invite tracking, rewards, and leaderboards.',
  level: 'Levels, XP, ranks, and prestige.',
  mod: 'Moderation tools for staff.',
  modmail: 'Modmail setup and ticket management.',
  music: 'Play music and manage the queue.',
  owner: 'Bot owner controls.',
  reactionroles: 'Reaction roles — setup and manage.',
  role: 'Role management and color roles.',
  staff: 'Staff tools — bot flags, errors, and antinuke.',
  starboard: 'Starboard setup and configuration.',
  steam: 'Steam account linking and info.',
  stream: 'Stream announcements and live checks.',
  suggest: 'Suggestions and suggestion settings.',
  tempvc: 'Temporary voice channels.',
  ticket: 'Support tickets — setup and manage.',
  tools: 'Posting, scheduling, and automation tools.',
  utility: 'Info, stats, and server tools.',
  verify: 'Verification setup and management.',
  weather: 'Weather forecasts and settings.',
  welcome: 'Welcome and goodbye messages.',
};

const PERM_NAMES = {
  2: 'Kick Members',
  4: 'Ban Members',
  8: 'Administrator',
  16: 'Manage Channels',
  32: 'Manage Server',
  8192: 'Manage Messages',
  1048576: 'Manage Events',
  268435456: 'Manage Roles',
  1073741824: 'Manage Emojis & Stickers',
  1099511627776: 'Moderate Members (Timeout)',
};

// Load every flat command file exactly the way the bot always has.
function loadFlatCommands() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const flat = [];
  for (const folder of fs.readdirSync(commandsPath)) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'))) {
      const module = require(path.join(folderPath, file));
      if (!module?.data?.name || typeof module.execute !== 'function') {
        console.warn(`[commands] Skipping ${folder}/${file}: missing data.name or execute().`);
        continue;
      }
      flat.push({ folder, file, module, json: module.data.toJSON() });
    }
  }
  return flat;
}

// Strip the parent-name prefix from a child name, e.g. `reactionroles-setup`
// under parent `reactionroles` -> `setup`. The prefix must be followed by
// '-', and the parent name minus/plus a trailing 's' also counts
// (parent `application` vs child prefix `application-`). If stripping would
// leave an empty name, or the name carries no parent prefix, keep it whole.
function stripPrefix(childName, parentName) {
  const prefixes = [parentName];
  if (parentName.endsWith('s')) prefixes.push(parentName.slice(0, -1));
  else prefixes.push(`${parentName}s`);
  for (const prefix of prefixes) {
    if (childName === prefix) return '';
    if (childName.startsWith(`${prefix}-`)) return childName.slice(prefix.length + 1);
  }
  return childName;
}

function buildConsolidated() {
  const flat = loadFlatCommands();
  const topLevel = [];
  const parents = new Map(); // parentName -> { children: Map, perms: Set, options: [] }
  const collisions = [];
  const seenFlat = new Set();

  const getParent = (name) => {
    if (!parents.has(name)) parents.set(name, { children: new Map(), perms: new Set(), options: [] });
    return parents.get(name);
  };

  for (const item of flat) {
    const { folder, module, json } = item;
    if (seenFlat.has(json.name)) throw new Error(`Duplicate flat command name: ${json.name}`);
    seenFlat.add(json.name);
    // Context-menu commands and already-grouped standalones keep their own
    // top-level slot, untouched.
    if ((json.type ?? 1) !== 1 || PARENT_MAP[folder] === null) {
      topLevel.push(module);
      continue;
    }
    const parentName = folder === 'utility' && UTILITY_TOOLS.has(json.name) ? 'tools' : PARENT_MAP[folder];
    const parent = getParent(parentName);

    // Strip top-level-only fields — they cannot live on a subcommand/group.
    const childJson = { ...json };
    delete childJson.default_member_permissions;
    delete childJson.dm_permission;
    delete childJson.contexts;
    delete childJson.nsfw;
    delete childJson.integration_types;
    for (const k of ['name_localizations', 'description_localizations']) {
      if (childJson[k] && Object.keys(childJson[k]).length === 0) delete childJson[k];
    }

    const isGrouped = (childJson.options || []).some((o) => o.type === 1 || o.type === 2);
    let subName = stripPrefix(json.name, parentName) || json.name;
    if (parent.children.has(subName)) {
      // Collision after stripping — keep the fuller name, and report it.
      collisions.push(`${parentName}: "${subName}" taken, keeping full name "${json.name}"`);
      subName = json.name;
      if (parent.children.has(subName)) throw new Error(`Unresolvable subcommand collision in ${parentName}: ${subName}`);
    }
    const option = isGrouped
      ? { type: 2, name: subName, description: childJson.description, options: childJson.options }
      : { type: 1, name: subName, description: childJson.description, ...(childJson.options?.length ? { options: childJson.options } : {}) };
    parent.options.push(option);
    parent.children.set(subName, { module, flatName: json.name, perms: json.default_member_permissions ?? null });
    parent.perms.add(json.default_member_permissions ?? null);
  }

  for (const [parentName, parent] of parents) {
    if (parent.options.length > 25) throw new Error(`Parent /${parentName} has ${parent.options.length} options — over Discord's 25 cap`);
    const json = {
      name: parentName,
      description: PARENT_DESCRIPTIONS[parentName],
      type: 1,
      options: parent.options,
    };
    // Uniform permissions live on the parent (Discord hides it from members
    // without them, as before). Mixed permissions stay a runtime check.
    const perms = [...parent.perms];
    if (perms.length === 1 && perms[0] !== null) json.default_member_permissions = perms[0];
    const children = parent.children;
    const data = { name: parentName, description: json.description, toJSON: () => json };
    const parentModule = {
      data,
      isParent: true,
      children,
      async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(false);
        const key = group || sub;
        const child = key ? children.get(key) : null;
        if (!child) return interaction.reply({ embeds: [errorEmbed('Unknown subcommand', 'That subcommand does not exist.')], ephemeral: true });
        if (child.perms && interaction.memberPermissions && !interaction.memberPermissions.has(child.perms)) {
          const label = PERM_NAMES[child.perms] || 'the required permission';
          return interaction.reply({ embeds: [errorEmbed('Missing permissions', `You need the **${label}** permission to use this command.`)], ephemeral: true });
        }
        return child.module.execute(interaction);
      },
    };
    topLevel.push(parentModule);
  }

  for (const note of collisions) console.warn(`[commands] ${note}`);
  return {
    topLevel,
    flatCount: flat.length,
    childCount: [...parents.values()].reduce((n, p) => n + p.children.size, 0),
    parentCount: parents.size,
  };
}

// Resolve the flat child a chat-input/autocomplete interaction targets, so
// feature toggles, mod logging, and command logging keep using flat names.
function resolveChild(command, interaction) {
  if (!command?.isParent) return null;
  try {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    const key = group || sub;
    if (!key) return null;
    return command.children.get(key) || null;
  } catch {
    return null;
  }
}

module.exports = { PARENT_MAP, UTILITY_TOOLS, PARENT_DESCRIPTIONS, loadFlatCommands, stripPrefix, buildConsolidated, resolveChild };
