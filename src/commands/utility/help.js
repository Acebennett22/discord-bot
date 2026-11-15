const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

// Since 1.15.0 the bot's 268 commands are consolidated into 33 parent
// commands with subcommands (client.commands holds parents, not flat names),
// so groups are defined by PARENT here — every parent must appear in exactly
// one group, or it is unreachable from /help. Discord caps a select menu at
// 25 options, so related parents share a group where it makes sense.
// Standalone top-level commands (giveaway, serverbackup, mediathreads) and
// the two message context-menu commands live in "other".
//
// Since 1.15.8 the opening view lists CATEGORIES only (one line per group);
// picking a group shows its commands 10 per page with ◀ / ▶ navigation.
const PAGE_SIZE = 10;
const GROUPS = {
  moderation: { label: '🛡️ Moderation', blurb: 'Bans, timeouts, warnings, sticky & automod', parents: ['mod', 'automod', 'sticky'] },
  music: { label: '🎵 Music', blurb: 'Play music in voice channels', parents: ['music'] },
  utility: { label: '🔧 Utility', blurb: 'Everyday server utilities', parents: ['utility'] },
  tools: { label: '🧰 Tools', blurb: 'Server tools & emoji management', parents: ['tools', 'emoji'] },
  fun: { label: '🎲 Fun & Games', blurb: 'Games, counting & birthdays', parents: ['fun', 'counting', 'birthday'] },
  tickets: { label: '🎫 Tickets', blurb: 'Support tickets & modmail', parents: ['ticket', 'modmail'] },
  streams: { label: '📺 Streams', blurb: 'Twitch & YouTube announcements', parents: ['stream'] },
  leveling: { label: '🏆 Leveling', blurb: 'XP, ranks & rewards', parents: ['level'] },
  steam: { label: '🎮 Steam', blurb: 'Steam profiles & game stats', parents: ['steam'] },
  giveaways: { label: '🎉 Giveaways', blurb: 'Run & enter giveaways', standalones: ['giveaway'] },
  reactionroles: { label: '🎭 Reaction Roles', blurb: 'Self-assignable roles', parents: ['reactionroles'] },
  gameservers: { label: '🖥️ Game Servers', blurb: 'Rust, The Isle & more', parents: ['gameserver'] },
  owner: { label: '👑 Owner', blurb: 'Bot owner & staff only', parents: ['owner', 'staff'] },
  ai: { label: '🤖 AI Chat', blurb: 'Chat with the AI', parents: ['ai'] },
  application: { label: '📝 Applications', blurb: 'Staff applications', parents: ['application'] },
  economy: { label: '🪙 Economy', blurb: 'Coins, jobs & casino', parents: ['economy', 'casino'] },
  faq: { label: '💬 FAQ & Custom', blurb: 'FAQs & custom commands', parents: ['faq', 'custom'] },
  invite: { label: '📨 Invites', blurb: 'Invite tracking & rewards', parents: ['invite'] },
  role: { label: '👥 Roles', blurb: 'Role management', parents: ['role'] },
  starboard: { label: '⭐ Starboard', blurb: 'Starred message highlights', parents: ['starboard'] },
  suggest: { label: '💡 Suggestions', blurb: 'Server suggestions', parents: ['suggest'] },
  verify: { label: '✅ Welcome & Verification', blurb: 'Verification & welcome setup', parents: ['verify', 'welcome'] },
  weather: { label: '🌤️ Weather', blurb: 'Weather forecasts', parents: ['weather'] },
  tempvc: { label: '🔊 Temp VC', blurb: 'Temporary voice channels', parents: ['tempvc'] },
  other: { label: '📦 Other', blurb: 'Backups, media threads & more', standalones: ['serverbackup', 'mediathreads'], context: ['Bookmark message', 'Translate message'] },
};

// One line per invocable path: plain subcommands as `/mod ban`, grouped
// children as `/mod warn add`, `/economy job set`, etc.
function linesForGroup(client, key) {
  const group = GROUPS[key];
  if (!group) return [];
  const lines = [];
  for (const parentName of group.parents || []) {
    const parent = client.commands.get(parentName);
    if (!parent) continue;
    for (const opt of parent.data.toJSON().options || []) {
      if (opt.type === 2) {
        for (const inner of opt.options || []) lines.push(`**/${parentName} ${opt.name} ${inner.name}** — ${inner.description}`);
      } else {
        lines.push(`**/${parentName} ${opt.name}** — ${opt.description}`);
      }
    }
  }
  for (const name of group.standalones || []) {
    const cmd = client.commands.get(name);
    if (!cmd) continue;
    const json = cmd.data.toJSON();
    if ((json.options || []).length) {
      for (const opt of json.options) lines.push(`**/${name} ${opt.name}** — ${opt.description}`);
    } else {
      lines.push(`**/${name}** — ${json.description}`);
    }
  }
  for (const name of group.context || []) {
    if (client.commands.get(name)) lines.push(`**${name}** — message context menu (right-click a message)`);
  }
  return lines;
}

function pageCount(client, key) {
  return Math.max(1, Math.ceil(linesForGroup(client, key).length / PAGE_SIZE));
}

// Opening view: categories only — one line per group, never the full list.
function homeEmbed(client) {
  const lines = Object.entries(GROUPS).map(([key, g]) => {
    const n = linesForGroup(client, key).length;
    return `**${g.label}** — ${g.blurb} (${n} command${n === 1 ? '' : 's'})`;
  });
  return infoEmbed(
    '🤖 Vikings Hall — Help',
    `Pick a category below to see its commands.\n\n**${countCommands(client)} commands** loaded.\n\n${lines.join('\n')}`,
  );
}

// One page of one group: at most PAGE_SIZE command lines, with the page
// indicator in the title (the shared footer is fixed by infoEmbed).
function groupEmbed(client, key, page = 0) {
  const group = GROUPS[key];
  if (!group) return infoEmbed('Help', 'Unknown category.');
  const lines = linesForGroup(client, key);
  const total = pageCount(client, key);
  const pageClamped = Math.min(Math.max(0, page), total - 1);
  const slice = lines.slice(pageClamped * PAGE_SIZE, (pageClamped + 1) * PAGE_SIZE);
  return infoEmbed(
    `${group.label} — Page ${pageClamped + 1}/${total}`,
    slice.length ? slice.join('\n') : 'No commands in this group.',
  );
}

// Real command total: one per grouped child + one per standalone top-level
// command + one per context-menu command (268 — computed, not hardcoded).
function countCommands(client) {
  let total = 0;
  for (const cmd of client.commands.values()) {
    const json = cmd.data.toJSON();
    if ((json.type ?? 1) !== 1) { total += 1; continue; } // context menu
    if (cmd.isParent) total += (json.options || []).length;
    else total += 1; // standalone chat command counts as one command
  }
  return total;
}

function menuRow(currentKey) {
  const current = currentKey ? GROUPS[currentKey] : null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder(current ? current.label : 'Pick a category…')
      .addOptions(Object.entries(GROUPS).map(([key, g]) => ({ label: g.label, value: key }))),
  );
}

function navRow(client, key, page) {
  const total = pageCount(client, key);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help_prev')
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId('help_home')
      .setLabel('Back to categories')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= total - 1),
  );
}

// Home view: menu only. Group view: menu + navigation buttons, so users can
// switch groups without going back first.
function componentsFor(client, view) {
  if (view.type === 'group') return [menuRow(view.key), navRow(client, view.key, view.page)];
  return [menuRow(null)];
}

function embedFor(client, view) {
  return view.type === 'group'
    ? groupEmbed(client, view.key, view.page)
    : homeEmbed(client);
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('List all commands, grouped by category.'),
  async execute(interaction) {
    // View state lives in this closure; the collector below mutates it.
    let view = { type: 'home' };
    const response = await interaction.reply({
      embeds: [homeEmbed(interaction.client)],
      components: componentsFor(interaction.client, view),
      withResponse: true,
    });
    const reply = response.resource.message;
    // Public since 1.15.7 — only the invoker may use the menu or the
    // navigation buttons (others get "This interaction failed" from Discord
    // instead of hijacking the list). No componentType filter: the collector
    // must accept both the select menu and the buttons.
    const collector = reply.createMessageComponentCollector({ time: 120_000, filter: (i) => i.user.id === interaction.user.id });
    collector.on('collect', async (i) => {
      if (i.customId === 'help_category') {
        view = { type: 'group', key: i.values[0], page: 0 };
      } else if (i.customId === 'help_prev' && view.type === 'group') {
        view = { ...view, page: Math.max(0, view.page - 1) };
      } else if (i.customId === 'help_next' && view.type === 'group') {
        view = { ...view, page: Math.min(pageCount(interaction.client, view.key) - 1, view.page + 1) };
      } else if (i.customId === 'help_home') {
        view = { type: 'home' };
      } else {
        return;
      }
      await i.update({ embeds: [embedFor(interaction.client, view)], components: componentsFor(interaction.client, view) });
    });
    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
  // Exported for tests (tmp/verify-help.js).
  GROUPS,
  PAGE_SIZE,
  linesForGroup,
  groupEmbed,
  homeEmbed,
  pageCount,
  countCommands,
  componentsFor,
  embedFor,
};
