const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { parseDuration, giveawayEmbed, enterRow, endGiveaway } = require('../../utils/giveaways');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create, end, reroll, or list giveaways.')
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway.')
      .addStringOption((o) => o.setName('prize').setDescription('What is being given away').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('How long (e.g. 10m, 1h, 1d)').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(10))
      .addRoleOption((o) => o.setName('required_role').setDescription('Role required to enter (optional)'))
      .addIntegerOption((o) => o.setName('min_days').setDescription('Min days in the server to enter (optional)').setMinValue(0).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('min_level').setDescription('Min leveling level to enter (optional)').setMinValue(0).setMaxValue(100))
      .addRoleOption((o) => o.setName('bonus_role').setDescription('Role that grants bonus entries (optional)'))
      .addIntegerOption((o) => o.setName('bonus_entries').setDescription('Bonus entries for the bonus role (default 1)').setMinValue(1).setMaxValue(10))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (defaults to this one)')))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway early and pick winner(s).')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winner(s) for an ended giveaway.')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List active giveaways in this server.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Giveaways need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms || ms < 10_000) return interaction.reply({ embeds: [errorEmbed('Invalid duration', 'Use a duration like 10m, 1h, or 1d (at least 10s).')] });
      const prize = interaction.options.getString('prize');
      const winners = interaction.options.getInteger('winners') || 1;
      const role = interaction.options.getRole('required_role');
      const minDays = interaction.options.getInteger('min_days');
      const minLevel = interaction.options.getInteger('min_level');
      const bonusRole = interaction.options.getRole('bonus_role');
      const bonusEntries = interaction.options.getInteger('bonus_entries') || (bonusRole ? 1 : null);
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const endsAt = new Date(Date.now() + ms);
      const res = await db.query(
        'INSERT INTO giveaways (guild_id, channel_id, prize, ends_at, winners_count, required_role_id, min_days_in_server, min_level, bonus_role_id, bonus_entries, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [interaction.guildId, channel.id, prize, endsAt, winners, role?.id || null, minDays ?? null, minLevel ?? null, bonusRole?.id || null, bonusEntries, interaction.user.id],
      );
      const giveawayId = res.insertId;
      const giveaway = { id: giveawayId, prize, winners_count: winners, ends_at: endsAt, required_role_id: role?.id || null, min_days_in_server: minDays ?? null, min_level: minLevel ?? null, bonus_role_id: bonusRole?.id || null, bonus_entries: bonusEntries };
      const msg = await channel.send({ embeds: [giveawayEmbed(giveaway, 0)], components: [enterRow(giveawayId)] });
      await db.query('UPDATE giveaways SET message_id = ? WHERE id = ?', [msg.id, giveawayId]);
      return interaction.reply({ embeds: [successEmbed('Giveaway started', `🎉 **${prize}** — ${winners} winner(s), ends <t:${Math.floor(endsAt.getTime() / 1000)}:R> in <#${channel.id}>.\nGiveaway ID: **${giveawayId}**`)] });
    }
    if (sub === 'list') {
      const rows = await db.query("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at", [interaction.guildId]);
      if (!rows?.length) return interaction.reply({  embeds: [infoEmbed('Giveaways', 'No active giveaways in this server.')] });
      return interaction.reply({  embeds: [infoEmbed('Active giveaways', rows.map((g) => {
        const reqs = [
          g.required_role_id ? `needs <@&${g.required_role_id}>` : null,
          g.min_days_in_server !== null && g.min_days_in_server !== undefined ? `${g.min_days_in_server}d+` : null,
          g.min_level !== null && g.min_level !== undefined ? `level ${g.min_level}+` : null,
          g.bonus_role_id ? `+${g.bonus_entries || 1} bonus for <@&${g.bonus_role_id}>` : null,
        ].filter(Boolean).join(', ');
        return `**#${g.id}** ${g.prize} — ${g.winners_count} winner(s), ends <t:${Math.floor(new Date(g.ends_at).getTime() / 1000)}:R> in <#${g.channel_id}>${reqs ? ` _(${reqs})_` : ''}`;
      }).join('\n'))] });
    }
    const id = interaction.options.getInteger('id');
    const rows = await db.query('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
    const giveaway = rows?.[0];
    if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Not found', `No giveaway #${id} in this server.`)] });
    if (sub === 'end' && giveaway.status !== 'active') return interaction.reply({ embeds: [errorEmbed('Already ended', 'That giveaway has already ended — use /giveaway reroll instead.')] });
    if (sub === 'reroll' && giveaway.status !== 'ended') return interaction.reply({ embeds: [errorEmbed('Not ended yet', 'Only ended giveaways can be re-rolled — use /giveaway end first.')] });
    await interaction.deferReply();
    const winners = await endGiveaway(interaction.client, giveaway, { reroll: sub === 'reroll' });
    return interaction.editReply({ embeds: [winners.length ? successEmbed('Winner(s) picked', `🎉 ${winners.map((w) => `<@${w}>`).join(', ')}`) : infoEmbed('No winner', 'No entries — no winner could be picked.')] });
  },
};
