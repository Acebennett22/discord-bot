// 🎉 Enter button for giveaways (one entry per user).
const { Events } = require('discord.js');
const db = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('giveaway_enter:')) return;
    const giveawayId = interaction.customId.split(':')[1];
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Giveaways need MySQL.')], ephemeral: true });
    const rows = await db.query('SELECT * FROM giveaways WHERE id = ? AND status = \'active\'', [giveawayId]);
    const giveaway = rows?.[0];
    if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Giveaway ended', 'This giveaway has ended.')], ephemeral: true });
    if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
      return interaction.reply({ embeds: [errorEmbed('Role required', 'You need the required role to enter this giveaway.')], ephemeral: true });
    }
    const existing = await db.query('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', [giveawayId, interaction.user.id]);
    if (existing?.length) return interaction.reply({ embeds: [infoEmbed('Already entered', 'You are already entered in this giveaway.')], ephemeral: true });
    await db.query('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)', [giveawayId, interaction.user.id]);
    return interaction.reply({ embeds: [successEmbed('Entered!', `🎉 You're entered in the giveaway for **${giveaway.prize}**!`)], ephemeral: true });
  },
};
