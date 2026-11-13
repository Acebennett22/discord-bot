const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('reactionroles-list').setDescription('List reaction-role messages in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')], ephemeral: true });
    const rows = await db.query('SELECT message_id, channel_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? ORDER BY message_id', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [infoEmbed('Reaction roles', 'No reaction-role messages in this server yet. Create one with /reactionroles-setup.')] });
    const byMsg = {};
    for (const r of rows) { (byMsg[r.message_id] = byMsg[r.message_id] || []).push(r); }
    const lines = Object.entries(byMsg).map(([msgId, pairs]) => {
      const ch = pairs[0].channel_id;
      return `**Message ${msgId}** (<#${ch}>):\n${pairs.map((p) => `  ${p.emoji} → <@&${p.role_id}>`).join('\n')}`;
    });
    return interaction.reply({ embeds: [infoEmbed('Reaction roles', lines.join('\n\n'))] });
  },
};
