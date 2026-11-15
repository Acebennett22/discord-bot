const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { parseWhen, formatRemaining, countdownEmbed, createCountdown, listCountdowns, cancelCountdown } = require('../../utils/countdowns');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('countdown')
    .setDescription('Create and manage countdowns.')
    .addSubcommand((s) => s.setName('create').setDescription('Create a countdown in a channel.')
      .addStringOption((o) => o.setName('title').setDescription('What are we counting down to?').setRequired(true))
      .addStringOption((o) => o.setName('when').setDescription('When: "in 2h30m", "in 3d", or "2026-12-25 18:00"').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (defaults to this channel)')))
    .addSubcommand((s) => s.setName('list').setDescription('List active countdowns in this server.'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a countdown.')
      .addIntegerOption((o) => o.setName('id').setDescription('Countdown ID (see /countdown list)').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await listCountdowns(interaction.guildId);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('⏳ Countdowns', 'No active countdowns in this server. Create one with `/countdown create`.')] });
      const fields = rows.map((r) => ({
        name: `#${r.id} — ${r.title}`,
        value: `${formatRemaining(new Date(r.ends_at).getTime() - Date.now())} left · <#${r.channel_id}> · ends <t:${Math.floor(new Date(r.ends_at).getTime() / 1000)}:F>`,
      }));
      return interaction.reply({  embeds: [infoEmbed('⏳ Active countdowns', '', fields)] });
    }
    if (sub === 'cancel') {
      const id = interaction.options.getInteger('id');
      const row = await cancelCountdown(interaction.guildId, id);
      if (!row) return interaction.reply({ embeds: [errorEmbed('Not found', `No countdown #${id} in this server.`)] });
      return interaction.reply({  embeds: [successEmbed('Countdown cancelled', `⏳ **${row.title}** (#${id}) has been cancelled.`)] });
    }
    // create
    const title = interaction.options.getString('title');
    const whenText = interaction.options.getString('when');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Invalid channel', 'Pick a text channel for the countdown.')] });
    const endsAt = parseWhen(whenText);
    if (!endsAt) {
      return interaction.reply({ embeds: [errorEmbed('Could not parse time', 'Use a relative time like `in 2h30m` or `in 3d`, or an absolute date like `2026-12-25 18:00`.')] });
    }
    if (endsAt.getTime() <= Date.now()) {
      return interaction.reply({ embeds: [errorEmbed('Time is in the past', 'The countdown end must be in the future.')] });
    }
    const row = await createCountdown(interaction.guildId, channel.id, title, endsAt, interaction.user.id);
    if (!row) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Countdowns need MySQL — connect the database first.')] });
    const message = await channel.send({ embeds: [countdownEmbed(row, endsAt.getTime() - Date.now())] }).catch(() => null);
    if (message) {
      const db = require('../../utils/database');
      await db.query('UPDATE countdowns SET message_id = ? WHERE id = ?', [message.id, row.id]).catch(() => {});
    }
    return interaction.reply({  embeds: [successEmbed('Countdown created', `⏳ **${title}** — ${formatRemaining(endsAt.getTime() - Date.now())} left, in <#${channel.id}>. It updates every minute once under 24h is left (every 5 minutes before that).`)] });
  },
};
