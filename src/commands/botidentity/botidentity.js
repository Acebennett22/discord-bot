const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const {
  getIdentity,
  setNicknameRow,
  fetchOwnMember,
  resetNickname,
  describeDiscordError,
} = require('../../utils/botIdentity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botidentity')
    .setDescription('Admin only: give the bot its own nickname in this server.')
    .addSubcommand((s) => s.setName('set-name').setDescription('Set the nickname the bot uses in this server (other servers unaffected).')
      .addStringOption((o) => o.setName('name').setDescription('Nickname for the bot here (1–32 characters)').setRequired(true).setMinLength(1).setMaxLength(32)))
    .addSubcommand((s) => s.setName('show').setDescription('Show the nickname and avatar picture the bot uses in this server.'))
    .addSubcommand((s) => s.setName('reset').setDescription('Clear the nickname back to the bot\'s global name (the picture is untouched).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Bot identity needs MySQL.')] });
    const sub = interaction.options.getSubcommand();

    if (sub === 'set-name') {
      const name = interaction.options.getString('name');
      if (!name || name.length > 32) {
        return interaction.reply({ embeds: [errorEmbed('Name too long', 'Nicknames can be at most 32 characters.')] });
      }
      const me = await fetchOwnMember(interaction.guild);
      if (!me) return interaction.reply({ embeds: [errorEmbed('Could not find me', 'I could not find my own member in this server.')] });
      if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
        return interaction.reply({ embeds: [errorEmbed('Missing permission', 'I need the **Change Nickname** permission in this server to change my nickname. Give my role that permission and try again.')] });
      }
      try {
        await me.setNickname(name);
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Could not change my nickname', describeDiscordError(err))] });
      }
      const saveError = await setNicknameRow(interaction.guildId, name);
      if (saveError) {
        return interaction.reply({ embeds: [successEmbed('Bot nickname set — for now', `In this server I'll now go by **${name}**. Other servers are unaffected.\n\n⚠️ I could not save it (${saveError.message || 'database error'}), so it may revert when I restart — try again in a bit.`)] });
      }
      return interaction.reply({ embeds: [successEmbed('Bot nickname set', `In this server I'll now go by **${name}**. Other servers are unaffected.`)] });
    }

    if (sub === 'show') {
      const me = await fetchOwnMember(interaction.guild);
      if (!me) return interaction.reply({ embeds: [errorEmbed('Could not find me', 'I could not find my own member in this server.')] });
      const row = await getIdentity(interaction.guildId);
      const nickname = row?.nickname ?? me.nickname;
      const fields = [
        { name: 'Nickname', value: nickname ? `**${nickname}**${row?.nickname ? '' : ' (set outside the bot)'}` : `Default — my global name (**${interaction.client.user.username}**)` },
        { name: 'Avatar', value: row?.avatar_path ? 'Custom picture for this server' : 'Global avatar' },
      ];
      if (row?.updated_at) fields.push({ name: 'Last changed', value: String(row.updated_at) });
      const description = row
        ? 'This server has its own bot identity — other servers are unaffected.'
        : 'This server has no custom bot identity — I\'m using my global name and picture here. An admin can set a nickname with `/botidentity set-name`; the picture is set on the dashboard (Bot Identity tab).';
      return interaction.reply({ embeds: [infoEmbed('Bot identity in this server', description, fields).setThumbnail(me.displayAvatarURL({ size: 256 }))] });
    }

    // reset — nickname only. The avatar picture is dashboard-only, so a
    // reset here must never touch it.
    const me = await fetchOwnMember(interaction.guild);
    if (!me) return interaction.reply({ embeds: [errorEmbed('Could not find me', 'I could not find my own member in this server.')] });
    const row = await getIdentity(interaction.guildId);
    const hasLive = me.nickname != null;
    if (!row?.nickname && !hasLive) {
      return interaction.reply({ embeds: [infoEmbed('Nothing to reset', 'This server has no custom bot nickname — I\'m already using my global name here. (The picture is set on the dashboard, and reset does not touch it.)')] });
    }
    const { hadStored, errors } = await resetNickname(interaction.guild);
    if (errors.length) {
      return interaction.reply({ embeds: [errorEmbed('Reset partly failed', `${errors.join('\n')}${hadStored ? '\n\nThe saved nickname was still cleared.' : ''}`)] });
    }
    return interaction.reply({ embeds: [successEmbed('Bot nickname reset', 'I\'m back to my global name in this server. The picture is unchanged.')] });
  },
};
