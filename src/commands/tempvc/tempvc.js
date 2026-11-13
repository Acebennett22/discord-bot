const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { requireTempOwner, isTempChannel } = require('../../utils/tempvc');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvc')
    .setDescription('Manage your temporary voice channel.')
    .addSubcommand((s) => s.setName('limit').setDescription('Set the user limit for your temp channel.')
      .addIntegerOption((o) => o.setName('limit').setDescription('Max users (0 = unlimited)').setMinValue(0).setMaxValue(99).setRequired(true)))
    .addSubcommand((s) => s.setName('lock').setDescription('Lock your temp channel (only you + people already in can join).'))
    .addSubcommand((s) => s.setName('unlock').setDescription('Unlock your temp channel.'))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename your temp channel.')
      .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('kick').setDescription('Kick someone from your temp channel.')
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true)))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim a temp channel whose owner left.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'claim') return claim(interaction);
    const check = await requireTempOwner(interaction);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Not your channel', check.reason)], ephemeral: true });
    const channel = check.channel;
    try {
      if (sub === 'limit') {
        const limit = interaction.options.getInteger('limit');
        await channel.setUserLimit(limit);
        return interaction.reply({ embeds: [successEmbed('Limit set', `Your channel now allows up to **${limit === 0 ? 'unlimited' : limit}** user(s).`)], ephemeral: true });
      }
      if (sub === 'lock') {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
        return interaction.reply({ embeds: [successEmbed('Channel locked', '🔒 Only members already inside (and you) can join now.')], ephemeral: true });
      }
      if (sub === 'unlock') {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
        return interaction.reply({ embeds: [successEmbed('Channel unlocked', '🔓 Anyone can join your channel again.')], ephemeral: true });
      }
      if (sub === 'rename') {
        const name = interaction.options.getString('name');
        await channel.setName(name);
        return interaction.reply({ embeds: [successEmbed('Channel renamed', `Renamed to **${name}**.`)], ephemeral: true });
      }
      if (sub === 'kick') {
        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member?.voice?.channel || member.voice.channelId !== channel.id) {
          return interaction.reply({ embeds: [errorEmbed('Not here', 'That member is not in your temp channel.')], ephemeral: true });
        }
        await member.voice.disconnect('Kicked from temp VC by the channel owner.').catch(() => null);
        return interaction.reply({ embeds: [successEmbed('Kicked', `👢 <@${user.id}> was removed from your channel.`)], ephemeral: true });
      }
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Could not do that', 'I might be missing the Manage Channels permission for temp voice channels.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [errorEmbed('Unknown action', 'Unknown temp VC action.')], ephemeral: true });
  },
};

async function claim(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) return interaction.reply({ embeds: [errorEmbed('Not in voice', 'Join the temp channel you want to claim first.')], ephemeral: true });
  const temp = await isTempChannel(interaction.guildId, voiceChannel.id);
  if (!temp) return interaction.reply({ embeds: [errorEmbed('Not a temp channel', 'That is not a temp voice channel.')], ephemeral: true });
  if (temp.owner_id === interaction.user.id) {
    return interaction.reply({ embeds: [successEmbed('Already yours', 'You already own this channel.')], ephemeral: true });
  }
  const owner = await interaction.guild.members.fetch(temp.owner_id).catch(() => null);
  if (owner?.voice?.channelId === voiceChannel.id) {
    return interaction.reply({ embeds: [errorEmbed('Owner is here', 'The channel owner is still in the channel — you can only claim it after they leave.')], ephemeral: true });
  }
  if (db.isEnabled()) {
    await db.query('UPDATE temp_channels SET owner_id = ? WHERE guild_id = ? AND channel_id = ?', [interaction.user.id, interaction.guildId, voiceChannel.id]);
  }
  await voiceChannel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: true, MoveMembers: true }).catch(() => {});
  return interaction.reply({ embeds: [successEmbed('Channel claimed', `👑 You now own **${voiceChannel.name}**.`)], ephemeral: true });
}
