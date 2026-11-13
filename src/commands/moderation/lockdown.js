const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock a channel (stop @everyone from sending messages).')
    .addSubcommand((s) => s.setName('lock').setDescription('Lock a channel so @everyone cannot send messages.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to lock (default: this channel)').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the lockdown').setMaxLength(500)))
    .addSubcommand((s) => s.setName('release').setDescription('Unlock a locked channel and restore its previous permissions.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to unlock (default: this channel)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('status').setDescription('List channels currently locked by /lockdown.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Lockdowns need MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const everyoneId = interaction.guild.roles.everyone.id;

    if (sub === 'status') {
      const rows = await db.query('SELECT channel_id, locked_by, locked_at FROM lockdowns WHERE guild_id = ?', [interaction.guildId]) || [];
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🔒 Lockdown status', 'No channels are currently locked.')], ephemeral: true });
      const lines = rows.map((r) => `<#${r.channel_id}> — locked by <@${r.locked_by}>${r.locked_at ? ` on ${new Date(r.locked_at).toLocaleString()}` : ''}`);
      return interaction.reply({ embeds: [infoEmbed('🔒 Locked channels', lines.join('\n'))], ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased() || channel.isThread?.()) {
      return interaction.reply({ embeds: [errorEmbed('Not a text channel', 'Pick a text channel to lock or unlock.')], ephemeral: true });
    }

    if (sub === 'lock') {
      const reason = interaction.options.getString('reason');
      const existing = await db.query(
        'SELECT channel_id FROM lockdowns WHERE guild_id = ? AND channel_id = ? AND target_id = ?',
        [interaction.guildId, channel.id, everyoneId],
      );
      if (existing?.length) {
        return interaction.reply({ embeds: [errorEmbed('Already locked', `<#${channel.id}> is already locked. Use /lockdown release to unlock it.`)], ephemeral: true });
      }
      // Remember the @everyone overwrite exactly so release can restore it.
      const prev = channel.permissionOverwrites.cache.get(everyoneId);
      const prevAllow = prev ? Number(prev.allow.bitfield) : null;
      const prevDeny = prev ? Number(prev.deny.bitfield) : null;
      await db.query(
        'INSERT INTO lockdowns (guild_id, channel_id, target_id, allow, deny, locked_by) VALUES (?, ?, ?, ?, ?, ?)',
        [interaction.guildId, channel.id, everyoneId, prevAllow, prevDeny, interaction.user.id],
      );
      try {
        await channel.permissionOverwrites.edit(everyoneId, { SendMessages: false });
      } catch {
        await db.query('DELETE FROM lockdowns WHERE guild_id = ? AND channel_id = ? AND target_id = ?', [interaction.guildId, channel.id, everyoneId]).catch(() => {});
        return interaction.reply({ embeds: [errorEmbed('Could not lock', `I don't have permission to change overwrites in <#${channel.id}>. Check my role and channel permissions.`)], ephemeral: true });
      }
      await channel.send({ embeds: [infoEmbed('🔒 Channel locked', `This channel has been locked by ${interaction.user}.${reason ? `\n**Reason:** ${reason}` : ''}\n@everyone can no longer send messages here.`)] }).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Channel locked', `<#${channel.id}> is now locked — @everyone can no longer send messages.${reason ? `\n**Reason:** ${reason}` : ''}`)], ephemeral: true });
    }

    // release
    const rows = await db.query(
      'SELECT allow, deny FROM lockdowns WHERE guild_id = ? AND channel_id = ? AND target_id = ?',
      [interaction.guildId, channel.id, everyoneId],
    );
    if (!rows?.length) {
      return interaction.reply({ embeds: [errorEmbed('Not locked', `<#${channel.id}> is not locked by /lockdown.`)], ephemeral: true });
    }
    const { allow, deny } = rows[0];
    try {
      if (allow === null && deny === null) {
        // There was no @everyone overwrite before the lock — remove it entirely.
        await channel.permissionOverwrites.delete(everyoneId);
      } else {
        await channel.permissionOverwrites.edit(everyoneId, {
          allow: allow === null ? 0n : BigInt(allow),
          deny: deny === null ? 0n : BigInt(deny),
        });
      }
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Could not unlock', `I don't have permission to change overwrites in <#${channel.id}>. The lockdown record was kept — try again once my permissions are fixed.`)], ephemeral: true });
    }
    await db.query('DELETE FROM lockdowns WHERE guild_id = ? AND channel_id = ? AND target_id = ?', [interaction.guildId, channel.id, everyoneId]);
    await channel.send({ embeds: [successEmbed('🔓 Channel unlocked', `This channel has been unlocked by ${interaction.user}. @everyone can send messages again.`)] }).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Channel unlocked', `<#${channel.id}> is unlocked and its previous @everyone permissions were restored.`)], ephemeral: true });
  },
};
