const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');
const { verifyPanelComponents } = require('../../utils/verification');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Admin only: set up the verification gate (channel, role, mode).')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel where the Verify button panel lives').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Role granted after verifying').setRequired(true))
    .addStringOption((o) => o.setName('mode').setDescription('button = click to verify; captcha = math question first').addChoices(
      { name: 'Button', value: 'button' },
      { name: 'Captcha (math question)', value: 'captcha' },
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const mode = interaction.options.getString('mode') || 'button';
    const settings = await getGuildSettings(interaction.guildId);
    // Post (or re-post) the verify panel in the channel.
    let panelMessageId = settings.verificationPanelMessageId || '';
    const panelText = mode === 'captcha'
      ? '✅ **Verify to join the conversation**\nClick **Verify** below and answer a quick math question to prove you\'re human.'
      : '✅ **Verify to join the conversation**\nClick **Verify** below to get access to the server.';
    try {
      const msg = await channel.send({ content: panelText, components: verifyPanelComponents() });
      panelMessageId = msg.id;
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Could not post the panel', `I can't send messages in <#${channel.id}>. Check my permissions there and try again.`)], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, {
      verificationChannelId: channel.id,
      verificationRoleId: role.id,
      verificationMode: mode,
      verificationPanelMessageId: panelMessageId,
      verificationEnabled: true,
    });
    return interaction.reply({
      embeds: [successEmbed('Verification set up', `**Channel:** <#${channel.id}>\n**Role:** <@&${role.id}>\n**Mode:** ${mode === 'captcha' ? 'Captcha (math question in a modal)' : 'Button (click to verify)'}\nNew members are DM'd where to verify. Verification is now **enabled** — turn it off with /verify-toggle.`)],
      ephemeral: true,
    });
  },
};
