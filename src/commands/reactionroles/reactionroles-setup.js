const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { buildRows, roleNameResolverFromGuild } = require('../../utils/reactionRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles-setup')
    .setDescription('Admin only: post a reaction-role message with emoji -> role pairs.')
    .addStringOption((o) => o.setName('title').setDescription('Message title').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (defaults to this one)'))
    .addStringOption((o) => o.setName('pairs').setDescription('Comma-separated emoji:role pairs, e.g. 🎮:Gamer, 📣:Announcements — use role NAMES'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Reaction roles need MySQL.')] });
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const title = interaction.options.getString('title');
    const pairsRaw = interaction.options.getString('pairs') || '';
    const msg = await channel.send({ embeds: [infoEmbed(title, 'Click a button below to toggle a role.')] });
    const added = [];
    for (const pair of pairsRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [emoji, roleName] = pair.split(':').map((s) => s.trim());
      if (!emoji || !roleName) continue;
      const role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) continue;
      await db.query(
        'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)',
        [interaction.guildId, channel.id, msg.id, emoji, role.id],
      );
      added.push(`${emoji} → ${role.name}`);
    }
    if (added.length) {
      await msg.edit({ embeds: [infoEmbed(title, `${added.join('\n')}\n\nClick a button below to toggle a role.`)], components: await buildRows(msg.id, roleNameResolverFromGuild(interaction.guild)) });
    }
    return interaction.reply({ embeds: [successEmbed('Reaction roles posted', `Message is live in <#${channel.id}> (ID: ${msg.id}).\n${added.length ? added.join('\n') : 'No pairs added yet — use /reactionroles-add to add emoji → role pairs.'}`)] });
  },
};
