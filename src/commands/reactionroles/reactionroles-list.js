const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('reactionroles-list').setDescription('List reaction-role messages in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')], ephemeral: true });
    const rows = await db.query('SELECT message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id = ? ORDER BY message_id', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Reaction roles', 'No reaction-role messages in this server yet. Create one with /reactionroles-setup.')] });
    const byMsg = {};
    for (const r of rows) { (byMsg[r.message_id] = byMsg[r.message_id] || []).push(r); }
    const lines = Object.entries(byMsg).map(([msgId, pairs]) => {
      const ch = pairs[0].channel_id;
      return `**Message ${msgId}** (<#${ch}>):\n${pairs.map((p) => {
        const reqs = [
          p.required_role_id ? `needs <@&${p.required_role_id}>` : null,
          p.min_days_in_server !== null && p.min_days_in_server !== undefined ? `${p.min_days_in_server}d+ in server` : null,
          p.min_level !== null && p.min_level !== undefined ? `level ${p.min_level}+` : null,
        ].filter(Boolean).join(', ');
        return `  ${p.emoji} → <@&${p.role_id}>${reqs ? ` _(${reqs})_` : ''}`;
      }).join('\n')}`;
    });
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Reaction roles', lines.join('\n\n'))] });
  },
};
