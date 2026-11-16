const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { requireOwner } = require('../../utils/ownerCheck');
const { successEmbed, errorEmbed, statsEmbed } = require('../../utils/embeds');
const presence = require('../../utils/presence');

const TYPE_CHOICES = [
  { name: 'Playing', value: 'Playing' },
  { name: 'Watching', value: 'Watching' },
  { name: 'Listening', value: 'Listening' },
  { name: 'Competing', value: 'Competing' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('presence')
    .setDescription('Owner only: manage the bot\'s Discord status/activity.')
    .addSubcommand((s) => s.setName('set').setDescription('Set a custom activity now (holds until the next rotation or /presence reset)')
      .addStringOption((o) => o.setName('text').setDescription('Activity text — supports {guilds}, {users}, {commands}, {uptime}, {version}').setRequired(true).setMaxLength(128))
      .addStringOption((o) => o.setName('type').setDescription('Activity type').addChoices(...TYPE_CHOICES)))
    .addSubcommand((s) => s.setName('reset').setDescription('Clear the override and go back to rotating templates'))
    .addSubcommand((s) => s.setName('list').setDescription('Show the rotation templates with live-filled values')),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;

    if (sub === 'set') {
      const text = interaction.options.getString('text');
      const type = interaction.options.getString('type') || 'Watching';
      const applied = await presence.setOverride(client, text, type);
      return interaction.reply({ embeds: [successEmbed('Presence set', `Now showing **${applied.type} ${applied.text}**.\nThis holds until the next rotation or \`/presence reset\`.`)] , flags: MessageFlags.Ephemeral });
    }
    if (sub === 'reset') {
      await presence.clearOverride(client);
      return interaction.reply({ embeds: [successEmbed('Presence reset', 'Back to rotating the configured templates.')], flags: MessageFlags.Ephemeral });
    }
    // list
    const activities = presence.loadActivities();
    const stats = await presence.getStats(client);
    const current = await presence.getCurrent(client);
    const lines = activities.map((a, i) => `${i + 1}. **${a.type}** ${presence.fillTemplate(a.text, stats)}`);
    return interaction.reply({ embeds: [statsEmbed(
      'Presence templates',
      `${lines.join('\n') || 'No templates configured.'}\n\n**Currently showing:** ${current ? `${current.type} ${current.text}${current.override ? ' *(one-off override)*' : ''}` : '—'}`,
    )], flags: MessageFlags.Ephemeral });
  },
};
