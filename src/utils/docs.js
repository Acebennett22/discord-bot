// Wiki/docs data: static content (docs/content.json) + the command
// reference, generated at request time by scanning src/commands/*/*.js
// so it can never list a command that doesn't exist (or miss one that
// does). Audience is derived from the command's permission bits and
// staff/owner checks in its source — never hand-written.
const fs = require('fs');
const path = require('path');

let contentCache = null;
let contentMtime = 0;

function getContent() {
  const file = path.join(__dirname, '..', '..', 'docs', 'content.json');
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (!contentCache || mtime !== contentMtime) {
      contentCache = JSON.parse(fs.readFileSync(file, 'utf8'));
      contentMtime = mtime;
    }
  } catch {
    contentCache = { gettingStarted: { title: 'Getting started', intro: '', steps: [] }, guides: [], faq: [] };
  }
  return contentCache;
}

// Folder -> display category, with per-command overrides for the mixed
// utility folder (AFK, polls, scheduled, auto-role) and the newer systems.
const FOLDER_CATEGORY = {
  moderation: 'Moderation', music: 'Music', utility: 'Utility', tickets: 'Tickets',
  leveling: 'Leveling', fun: 'Fun', giveaways: 'Giveaways',
  reactionroles: 'Reaction Roles', streams: 'Streams', gameservers: 'Game Servers',
  steam: 'Steam', applications: 'Applications', invites: 'Invites',
  staff: 'Staff / Owner', owner: 'Staff / Owner', welcome: 'Welcome',
  automod: 'Automod', suggestions: 'Suggestions', economy: 'Economy',
  casino: 'Casino', starboard: 'Starboard', customcommands: 'Custom Commands',
  faq: 'FAQ', emojis: 'Emojis',
};
const COMMAND_CATEGORY = {
  afk: 'AFK', 'afk-remove': 'AFK', poll: 'Polls', 'poll-end': 'Polls',
  schedule: 'Scheduled', 'schedule-list': 'Scheduled', 'schedule-cancel': 'Scheduled',
  remindme: 'Scheduled', autorole: 'Auto-Role', presence: 'Presence',
  buy: 'Inventory & Trading', sell: 'Inventory & Trading', inventory: 'Inventory & Trading',
  'open-crate': 'Inventory & Trading', use: 'Inventory & Trading',
  trade: 'Inventory & Trading', 'trade-cancel': 'Inventory & Trading',
  botflags: 'Bot Tracking', botflag: 'Bot Tracking', 'botflag-clear': 'Bot Tracking',
  bottrack: 'Bot Tracking',
  countdown: 'Countdowns', prestige: 'Leveling', 'prestige-leaderboard': 'Leveling',
  'ticket-panel': 'Tickets', inviterole: 'Invites',
  dj: 'Music', 'dj-setup': 'Music', 'queue-clear': 'Music',
  'emoji-add': 'Emojis', 'emoji-remove': 'Emojis', 'emoji-list': 'Emojis',
};
const CATEGORY_ORDER = [
  'Moderation', 'Music', 'Utility', 'Tickets', 'Leveling', 'Fun', 'Giveaways',
  'Reaction Roles', 'Streams', 'Game Servers', 'Steam', 'Applications', 'Invites',
  'Staff / Owner', 'Welcome', 'Automod', 'Suggestions', 'Economy', 'Casino',
  'Inventory & Trading', 'Starboard', 'Custom Commands', 'AFK', 'Polls', 'FAQ',
  'Presence', 'Scheduled', 'Auto-Role', 'Bot Tracking', 'Emojis', 'Countdowns',
];

function audienceOf(source, perms) {
  if (/requireOwner|isOwner\(/.test(source)) return 'Owner';
  if (/isStaff\(/.test(source)) return 'Staff';
  if (perms) {
    if (/Administrator|ManageGuild/.test(perms)) return 'Admin';
    return 'Moderator';
  }
  return 'Everyone';
}

function scanCommands() {
  const base = path.join(__dirname, '..', 'commands');
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const folder of fs.readdirSync(base)) {
    const dir = path.join(base, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      const name = source.match(/\.setName\('([^']+)'\)/)?.[1];
      // Description regex allows escaped quotes (e.g. 'server\'s stats').
      const rawDesc = source.match(/\.setDescription\('((?:[^'\\]|\\.)*)'\)/)?.[1];
      const desc = rawDesc ? rawDesc.replace(/\\'/g, "'").replace(/\\\\/g, '\\') : null;
      if (!name || !desc) continue;
      const perms = source.match(/setDefaultMemberPermissions\(([^)]+)\)/)?.[1] || null;
      const subs = [...source.matchAll(/\.addSubcommand\([\s\S]*?\.setName\('([^']+)'\)/g)].map((m) => m[1]);
      out.push({
        name, description: desc,
        category: COMMAND_CATEGORY[name] || FOLDER_CATEGORY[folder] || folder,
        audience: audienceOf(source, perms),
        subcommands: subs,
      });
    }
  }
  out.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    return a.name.localeCompare(b.name);
  });
  return out;
}

function groupedCommands() {
  const groups = [];
  for (const cmd of scanCommands()) {
    let g = groups.find((x) => x.category === cmd.category);
    if (!g) { g = { category: cmd.category, commands: [] }; groups.push(g); }
    g.commands.push(cmd);
  }
  return groups;
}

module.exports = { getContent, scanCommands, groupedCommands };
