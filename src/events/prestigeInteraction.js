// Prestige confirm/cancel buttons (from /prestige). Separate listener from
// interactionCreate, which only handles slash commands.
const { Events } = require('discord.js');
const { doPrestige, prestigeMultiplier } = require('../utils/leveling');
const { getGuildSettings } = require('../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('prestige_confirm:') && !interaction.customId.startsWith('prestige_cancel:')) return;
    const [action, userId] = interaction.customId.split(':');
    if (interaction.user.id !== userId) {
      return interaction.reply({ embeds: [errorEmbed('Not yours', 'Only the member who ran `/prestige` can confirm it.')] });
    }
    if (action === 'prestige_cancel') {
      return interaction.update({ embeds: [successEmbed('Prestige cancelled', 'No changes made — your level and XP are untouched.')], components: [] });
    }
    await interaction.deferUpdate();
    const result = await doPrestige(interaction.user.id, interaction.guildId);
    if (!result.ok) {
      const msg = result.reason === 'level'
        ? `You are level ${result.level} — you need level ${result.maxLevel} to prestige.`
        : 'Prestige needs MySQL — connect the database first.';
      return interaction.editReply({ embeds: [errorEmbed('Cannot prestige', msg)], components: [] });
    }
    // Prestige role (if configured) — granted on top of the reset.
    let roleNote = '';
    try {
      const settings = await getGuildSettings(interaction.guildId);
      if (settings.prestigeRoleId) {
        const role = interaction.guild.roles.cache.get(settings.prestigeRoleId);
        if (role && !interaction.member.roles.cache.has(role.id)) {
          await interaction.member.roles.add(role).catch(() => {});
          roleNote = `\nYou also earned the **${role.name}** role.`;
        }
      }
    } catch {}
    return interaction.editReply({
      embeds: [successEmbed(`⭐ Prestige ${result.prestige}!`, `Your level and XP were reset to 0. You now have a permanent **x${prestigeMultiplier(result.prestige).toFixed(1)}** XP multiplier.${roleNote}`)],
      components: [],
    });
  },
};
