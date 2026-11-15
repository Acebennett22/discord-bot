const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

// Since 1.15.0 the bot's 266 commands are consolidated into 32 parent
// commands with subcommands (client.commands holds parents, not flat names),
// so groups are defined by PARENT here — every parent must appear in exactly
// one group, or it is unreachable from /help. Discord caps a select menu at
// 25 options, so related parents share a group where it makes sense.
// Standalone top-level commands (giveaway, serverbackup, mediathreads) and
// the two message context-menu commands live in "other".
const GROUPS = {
  moderation: { label: '🛡️ Moderation', parents: ['mod', 'automod'] },
  music: { label: '🎵 Music', parents: ['music'] },
  utility: { label: '🔧 Utility', parents: ['utility'] },
  tools: { label: '🧰 Tools', parents: ['tools', 'emoji'] },
  fun: { label: '🎲 Fun & Games', parents: ['fun', 'counting', 'birthday'] },
  tickets: { label: '🎫 Tickets', parents: ['ticket', 'modmail'] },
  streams: { label: '📺 Streams', parents: ['stream'] },
  leveling: { label: '🏆 Leveling', parents: ['level'] },
  steam: { label: '🎮 Steam', parents: ['steam'] },
  giveaways: { label: '🎉 Giveaways', standalones: ['giveaway'] },
  reactionroles: { label: '🎭 Reaction Roles', parents: ['reactionroles'] },
  gameservers: { label: '🖥️ Game Servers', parents: ['gameserver'] },
  owner: { label: '👑 Owner', parents: ['owner', 'staff'] },
  ai: { label: '🤖 AI Chat', parents: ['ai'] },
  application: { label: '📝 Applications', parents: ['application'] },
  economy: { label: '🪙 Economy', parents: ['economy', 'casino'] },
  faq: { label: '💬 FAQ & Custom', parents: ['faq', 'custom'] },
  invite: { label: '📨 Invites', parents: ['invite'] },
  role: { label: '👥 Roles', parents: ['role'] },
  starboard: { label: '⭐ Starboard', parents: ['starboard'] },
  suggest: { label: '💡 Suggestions', parents: ['suggest'] },
  verify: { label: '✅ Welcome & Verification', parents: ['verify', 'welcome'] },
  weather: { label: '🌤️ Weather', parents: ['weather'] },
  tempvc: { label: '🔊 Temp VC', parents: ['tempvc'] },
  other: { label: '📦 Other', standalones: ['serverbackup', 'mediathreads'], context: ['Bookmark message', 'Translate message'] },
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

function groupEmbed(client, key) {
  const group = GROUPS[key];
  if (!group) return infoEmbed('Help', 'Unknown category.');
  const lines = linesForGroup(client, key);
  return infoEmbed(group.label, lines.length ? lines.join('\n') : 'No commands in this group.');
}

// Real command total: one per grouped child + one per standalone top-level
// command + one per context-menu command (266 — computed, not hardcoded).
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

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('List all commands, grouped by category.'),
  async execute(interaction) {
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Pick a category…')
        .addOptions(Object.entries(GROUPS).map(([key, g]) => ({ label: g.label, value: key }))),
    );
    const response = await interaction.reply({ ephemeral: true,
      embeds: [infoEmbed('🤖 Vikings Hall — Help', `Pick a category below to see its commands.\n\n**${countCommands(interaction.client)} commands** loaded.`)],
      components: [menu],
      withResponse: true,
    });
    const reply = response.resource.message;
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 120_000 });
    collector.on('collect', async (sel) => {
      await sel.update({ embeds: [groupEmbed(interaction.client, sel.values[0])], components: [menu] });
    });
    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
  // Exported for tests (tmp/verify-help.js).
  GROUPS,
  linesForGroup,
  groupEmbed,
  countCommands,
};
