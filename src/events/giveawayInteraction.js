// 🎉 Enter button for giveaways (one entry per user).
// Requirements (required role / min days / min leveling level) are checked
// first — a member who misses one gets an ephemeral message naming exactly
// what they missed, and is not entered.
const { MessageFlags, Events } = require('discord.js');
const db = require('../utils/database');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');
const { getRank } = require('../utils/leveling');
const { computeBonusEntries, recordBonusEntry } = require('../utils/giveaways');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('giveaway_enter:')) return;
    const giveawayId = interaction.customId.split(':')[1];
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Giveaways need MySQL.')] });
    const rows = await db.query('SELECT * FROM giveaways WHERE id = ? AND status = \'active\'', [giveawayId]);
    const giveaway = rows?.[0];
    if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Giveaway ended', 'This giveaway has ended.')] });
    const missed = [];
    if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
      missed.push(`You need the <@&${giveaway.required_role_id}> role to enter.`);
    }
    if (giveaway.min_days_in_server !== null && giveaway.min_days_in_server !== undefined) {
      const joinedAt = interaction.member.joinedTimestamp;
      const days = joinedAt ? Math.floor((Date.now() - joinedAt) / 86_400_000) : 0;
      if (days < giveaway.min_days_in_server) {
        missed.push(`You need to have been in the server for at least ${giveaway.min_days_in_server} days (you're at ${days}).`);
      }
    }
    if (giveaway.min_level !== null && giveaway.min_level !== undefined) {
      const rank = await getRank(interaction.user.id, interaction.guildId).catch(() => null);
      const level = rank?.level ?? 0;
      if (level < giveaway.min_level) {
        missed.push(`You need leveling level ${giveaway.min_level} or higher (you're level ${level}).`);
      }
    }
    if (missed.length) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t meet the requirements', `You can't enter the giveaway for **${giveaway.prize}** yet:\n${missed.map((m) => `• ${m}`).join('\n')}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    const existing = await db.query('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', [giveawayId, interaction.user.id]);
    if (existing?.length) return interaction.reply({ embeds: [infoEmbed('Already entered', 'You are already entered in this giveaway.')], flags: MessageFlags.Ephemeral });
    await db.query('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)', [giveawayId, interaction.user.id]);
    // Bonus entries (1.12.4): bonus role + Nitro booster.
    const { bonus, reasons } = await computeBonusEntries(giveaway, interaction.member).catch(() => ({ bonus: 0, reasons: [] }));
    if (bonus > 0) await recordBonusEntry(giveawayId, interaction.user.id, bonus, reasons.join('; ')).catch(() => {});
    const totalEntries = 1 + bonus;
    return interaction.reply({ embeds: [successEmbed('Entered!', `🎉 You're entered in the giveaway for **${giveaway.prize}**!\n**Entries:** ${totalEntries}${bonus > 0 ? ` (includes ${bonus} bonus: ${reasons.join(', ')})` : ''}`)], flags: MessageFlags.Ephemeral });
  },
};
