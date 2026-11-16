// Reaction-role button clicks toggle the role (one click = on, again = off).
// Requirements (required role / min days in server / min leveling level)
// are checked before granting — a member who misses one gets an ephemeral
// embed naming exactly what they missed. Removing a role never checks
// requirements.
const { MessageFlags, Events } = require('discord.js');
const { getMappings, isMessageEnabled } = require('../utils/reactionRoles');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { getRank } = require('../utils/leveling');

function requirementSummary(mapping) {
  const reqs = [];
  if (mapping.required_role_id) reqs.push(`the <@&${mapping.required_role_id}> role`);
  if (mapping.min_days_in_server !== null && mapping.min_days_in_server !== undefined) reqs.push(`${mapping.min_days_in_server}+ days in the server`);
  if (mapping.min_level !== null && mapping.min_level !== undefined) reqs.push(`leveling level ${mapping.min_level}+`);
  return reqs;
}

async function checkRequirements(interaction, mapping) {
  const missed = [];
  if (mapping.required_role_id && !interaction.member.roles.cache.has(mapping.required_role_id)) {
    missed.push(`You need the <@&${mapping.required_role_id}> role first.`);
  }
  if (mapping.min_days_in_server !== null && mapping.min_days_in_server !== undefined) {
    const joinedAt = interaction.member.joinedTimestamp;
    const days = joinedAt ? Math.floor((Date.now() - joinedAt) / 86_400_000) : 0;
    if (days < mapping.min_days_in_server) {
      missed.push(`You need to have been in the server for at least ${mapping.min_days_in_server} days (you're at ${days}).`);
    }
  }
  if (mapping.min_level !== null && mapping.min_level !== undefined) {
    const rank = await getRank(interaction.user.id, interaction.guildId).catch(() => null);
    const level = rank?.level ?? 0;
    if (level < mapping.min_level) {
      missed.push(`You need leveling level ${mapping.min_level} or higher (you're level ${level}).`);
    }
  }
  return missed;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('rr:')) return;
    const roleId = interaction.customId.split(':')[1];
    // Paused reaction-role message (1.14.1): buttons are disabled when off,
    // but a stale click can still arrive — refuse it instead of granting.
    if (!(await isMessageEnabled(interaction.message.id))) {
      return interaction.reply({ embeds: [errorEmbed('Paused', 'Reaction roles are paused on this message right now.')] });
    }
    const mappings = await getMappings(interaction.message.id);
    const mapping = mappings.find((m) => m.role_id === roleId);
    if (!mapping) return interaction.reply({ embeds: [errorEmbed('Unavailable', 'That role is no longer available on this message.')] });
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ embeds: [errorEmbed('Role gone', 'That role no longer exists.')] });
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(role).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Role removed', `➖ Removed the **${role.name}** role.`)], flags: MessageFlags.Ephemeral });
    }
    const missed = await checkRequirements(interaction, mapping);
    if (missed.length) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t meet the requirements', `You can't take the **${role.name}** role yet:\n${missed.map((m) => `• ${m}`).join('\n')}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.member.roles.add(role).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Role added', `➕ You now have the **${role.name}** role!`)], flags: MessageFlags.Ephemeral });
  },
};
