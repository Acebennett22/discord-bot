const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('invite-info').setDescription('Details on one invite code.')
    .addStringOption((o) => o.setName('code').setDescription('Invite code (e.g. abc123, or the part after discord.gg/)').setRequired(true)),
  async execute(interaction) {
    const code = interaction.options.getString('code').replace(/^https?:\/\/(www\.)?discord\.gg\//, '').trim();
    const live = await interaction.guild.invites.fetch().catch(() => null);
    const liveInv = live?.get(code);
    let row = null;
    if (db.isEnabled()) {
      const rows = await db.query('SELECT * FROM invites WHERE guild_id = ? AND code = ?', [interaction.guildId, code]);
      row = rows?.[0];
    }
    if (!liveInv && !row) return interaction.reply({ embeds: [errorEmbed('Invite not found', `No invite with code \`${code}\` in this server.`)], ephemeral: true });
    const inviter = liveInv?.inviter?.id || row?.inviter_id;
    const uses = liveInv?.uses ?? row?.uses ?? 0;
    const maxUses = liveInv?.maxUses ?? row?.max_uses;
    const channelId = liveInv?.channelId || row?.channel_id;
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed(`🔗 Invite discord.gg/${code}`,
      `**Created by:** ${inviter ? `<@${inviter}>` : 'unknown'}\n**Uses:** ${uses}${maxUses ? ` / ${maxUses}` : ' (unlimited)'}\n**Channel:** ${channelId ? `<#${channelId}>` : 'unknown'}\n**Expires:** ${liveInv?.expiresAt ? `<t:${Math.floor(liveInv.expiresAt.getTime() / 1000)}:R>` : 'never / unknown'}`)] });
  },
};
