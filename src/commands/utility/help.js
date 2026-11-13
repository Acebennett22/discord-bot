const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

const GROUPS = {
  moderation: { label: '🛡️ Moderation', commands: ['kick', 'ban', 'timeout', 'warn', 'clear', 'unban', 'setup'] },
  music: { label: '🎵 Music', commands: ['play', 'skip', 'stop', 'queue', 'pause', 'resume'] },
  utility: { label: '🔧 Utility', commands: ['ping', 'uptime', 'serverinfo', 'userinfo', 'status', 'botstats', 'mystats', 'shards', 'topcommands', 'topusers', 'guildstats', 'globalstats', 'serverstats-setup', 'serverstats-toggle', 'help'] },
  fun: { label: '🎲 Fun & Games', commands: ['8ball', 'coinflip', 'dice', 'rps', 'trivia'] },
  tickets: { label: '🎫 Tickets', commands: ['ticket-setup', 'ticket-close', 'ticket-add', 'ticket-remove', 'ticket-claim'] },
  streams: { label: '📺 Streams', commands: ['stream-add', 'stream-remove', 'stream-list', 'stream-announce'] },
  leveling: { label: '🏆 Leveling', commands: ['rank', 'leaderboard', 'setlevel'] },
  steam: { label: '🎮 Steam', commands: ['steam', 'linksteam'] },
  giveaways: { label: '🎉 Giveaways', commands: ['giveaway'] },
  reactionroles: { label: '🎭 Reaction Roles', commands: ['reactionroles-setup', 'reactionroles-add', 'reactionroles-remove', 'reactionroles-list'] },
  gameservers: { label: '🖥️ Game Servers', commands: ['serverstatus', 'gameserver-add', 'gameserver-remove', 'gameserver-list'] },
  owner: { label: '👑 Owner', commands: ['restart', 'reload', 'shutdown', 'eval'] },
};

function groupEmbed(client, key) {
  const group = GROUPS[key];
  const lines = group.commands
    .map((name) => client.commands.get(name))
    .filter(Boolean)
    .map((c) => `**/${c.data.name}** — ${c.data.description}`);
  return infoEmbed(group.label, lines.length ? lines.join('\n') : 'No commands in this group.');
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
    const reply = await interaction.reply({
      embeds: [infoEmbed('🤖 Ace Bot — Help', `Pick a category below to see its commands.\n\n**${interaction.client.commands.size} commands** loaded.`)],
      components: [menu],
      fetchReply: true,
    });
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 120_000 });
    collector.on('collect', async (sel) => {
      await sel.update({ embeds: [groupEmbed(interaction.client, sel.values[0])], components: [menu] });
    });
    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
