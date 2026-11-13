// Event RSVP buttons — customId event:<status>:<eventId>.
const { Events } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../utils/embeds');
const events = require('../utils/scheduledEvents');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('event:')) return;
    const [, status, eventIdStr] = interaction.customId.split(':');
    const eventId = Number(eventIdStr);
    if (!['going', 'maybe', 'not_going'].includes(status) || !eventId) return;
    const event = await events.getEvent(eventId).catch(() => null);
    if (!event || event.guild_id !== interaction.guildId) return interaction.reply({ embeds: [errorEmbed('Event not found', 'That event no longer exists.')], ephemeral: true });
    if (event.status !== 'upcoming') return interaction.reply({ embeds: [infoEmbed('Event closed', `**${event.title}** is ${event.status} — RSVPs are closed.`)], ephemeral: true });
    await events.setRsvp(eventId, interaction.user.id, status).catch(() => null);
    await events.refreshEventMessage(interaction.client, event).catch(() => {});
    return interaction.reply({ embeds: [infoEmbed('RSVP saved', `You're marked **${events.RSVP_LABELS[status]}** for **${event.title}**.`)], ephemeral: true });
  },
};
