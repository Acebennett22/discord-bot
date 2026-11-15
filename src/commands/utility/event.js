const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const events = require('../../utils/scheduledEvents');

function parseDateTime(input) {
  // Accepts "YYYY-MM-DD HH:mm" or "YYYY-MM-DD". Times are the server's
  // local time; Discord renders them in each viewer's timezone.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec((input || '').trim());
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4] || '12', 10), parseInt(m[5] || '0', 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Schedule server events with RSVP buttons.')
    .addSubcommand((s) => s.setName('create').setDescription('Staff: create a new event.')
      .addStringOption((o) => o.setName('title').setDescription('Event title').setRequired(true).setMaxLength(256))
      .addStringOption((o) => o.setName('when').setDescription('Date/time — YYYY-MM-DD HH:mm (server local time)').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('What is it about?').setMaxLength(2000))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (defaults to this one)')))
    .addSubcommand((s) => s.setName('list').setDescription('List upcoming events.'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Admin: cancel an event.')
      .addIntegerOption((o) => o.setName('id').setDescription('Event ID (from /event list)').setRequired(true))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Events need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const list = await events.listUpcomingEvents(interaction.guildId, 10);
      if (!list.length) return interaction.reply({ embeds: [infoEmbed('📅 Upcoming events', 'No events scheduled. Staff can create one with /event create.')] });
      const lines = await Promise.all(list.map(async (e) => {
        const counts = await events.getRsvpCounts(e.id);
        return `**#${e.id} ${e.title}** — <t:${Math.floor(new Date(e.starts_at).getTime() / 1000)}:F>\n<#${e.channel_id}> · ✅ ${counts.going} going · 🤔 ${counts.maybe} maybe`;
      }));
      return interaction.reply({ embeds: [infoEmbed('📅 Upcoming events', lines.join('\n\n'))] });
    }
    if (!interaction.memberPermissions?.has('ManageGuild') && !interaction.memberPermissions?.has('ManageEvents')) {
      return interaction.reply({ embeds: [errorEmbed('Staff only', 'You need Manage Server or Manage Events to do that.')] });
    }
    if (sub === 'create') {
      const title = interaction.options.getString('title');
      const when = parseDateTime(interaction.options.getString('when'));
      if (!when) return interaction.reply({ embeds: [errorEmbed('Bad date/time', 'Use `YYYY-MM-DD HH:mm` — for example `2026-11-20 19:00`.')] });
      if (when.getTime() <= Date.now()) return interaction.reply({ embeds: [errorEmbed('Date is in the past', 'Pick a future date and time.')] });
      const description = interaction.options.getString('description');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const id = await events.createEvent(interaction.guildId, channel.id, title, description, when, interaction.user.id);
      const event = await events.getEvent(id);
      const msg = await channel.send({ embeds: [events.eventEmbed(event, { going: 0, maybe: 0, not_going: 0 })], components: [events.eventRow(id)] }).catch(() => null);
      if (!msg) return interaction.reply({ embeds: [errorEmbed('Could not post', 'I could not send a message in that channel — check my permissions.')] });
      await db.query('UPDATE scheduled_events SET message_id = ? WHERE id = ?', [msg.id, id]);
      return interaction.reply({ embeds: [successEmbed('Event created', `📅 **${title}** is scheduled for <t:${Math.floor(when.getTime() / 1000)}:F> in <#${channel.id}> (event #${id}). RSVPs get a reminder 1 hour before.`)] });
    }
    // cancel
    const id = interaction.options.getInteger('id');
    const event = await events.getEvent(id);
    if (!event || event.guild_id !== interaction.guildId) return interaction.reply({ embeds: [errorEmbed('Not found', `No event #${id} in this server.`)] });
    if (event.status === 'cancelled') return interaction.reply({ embeds: [infoEmbed('Already cancelled', `Event #${id} was already cancelled.`)] });
    await events.cancelEvent(id);
    const channel = await interaction.client.channels.fetch(event.channel_id).catch(() => null);
    if (channel?.isTextBased() && event.message_id) {
      const msg = await channel.messages.fetch(event.message_id).catch(() => null);
      if (msg) await msg.edit({ content: `❌ **${event.title}** has been cancelled.`, embeds: [], components: [] }).catch(() => {});
    }
    return interaction.reply({ embeds: [successEmbed('Event cancelled', `📅 **${event.title}** (#${id}) has been cancelled.`)] });
  },
};
