// Verification gate: new members verify before getting the member role.
// Two modes (per-guild setting):
//  - button: click the Verify button on the panel -> role granted.
//  - captcha: click Verify -> a modal asks a simple math question (image-free
//    captcha; honest about it in the README). Answer right -> role granted.
// Challenges live in memory (5-minute expiry); the grant itself is logged
// to MySQL (verification_logs).
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { errorEmbed, successEmbed } = require('./embeds');

// userId -> { guildId, answer, question, expiresAt }
const pendingChallenges = new Map();

function makeMathChallenge() {
  const a = 2 + Math.floor(Math.random() * 9);
  const b = 2 + Math.floor(Math.random() * 9);
  const op = Math.random() < 0.5 ? '+' : '-';
  const answer = op === '+' ? a + b : a - b;
  return { question: `What is ${a} ${op} ${b}?`, answer: String(answer) };
}

function verifyPanelComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:btn').setLabel('✅ Verify').setStyle(ButtonStyle.Success),
  )];
}

async function grantVerification(member, mode) {
  const settings = await getGuildSettings(member.guild.id);
  const roleId = settings.verificationRoleId;
  if (!roleId) return { ok: false, reason: 'No verification role is set up yet — ask an admin to run /verify-setup.' };
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, reason: 'The verification role no longer exists — ask an admin to re-run /verify-setup.' };
  await member.roles.add(role).catch(() => null);
  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO verification_logs (guild_id, user_id, mode, status) VALUES (?, ?, ?, ?)',
      [member.guild.id, member.id, mode, 'granted'],
    );
  }
  return { ok: true, role };
}

async function logVerification(guildId, userId, mode, status) {
  if (!db.isEnabled()) return;
  await db.query(
    'INSERT INTO verification_logs (guild_id, user_id, mode, status) VALUES (?, ?, ?, ?)',
    [guildId, userId, mode, status],
  );
}

// Called on guildMemberAdd: DM the newcomer where to verify. Never fatal.
async function onMemberJoin(member) {
  const settings = await getGuildSettings(member.guild.id).catch(() => null);
  if (!settings?.verificationEnabled || !settings.verificationChannelId) return;
  const channel = member.guild.channels.cache.get(settings.verificationChannelId);
  const where = channel ? `<#${channel.id}>` : 'the verification channel';
  await member.send({
    embeds: [successEmbed(
      `Welcome to ${member.guild.name}!`,
      `Before you can chat, please verify yourself in ${where} — click the **Verify** button${settings.verificationMode === 'captcha' ? ' and answer the quick math question' : ''}.`,
    )],
  }).catch(() => {});
}

function openCaptchaModal(interaction) {
  const challenge = makeMathChallenge();
  pendingChallenges.set(interaction.user.id, {
    guildId: interaction.guildId,
    answer: challenge.answer,
    question: challenge.question,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  const modal = new ModalBuilder().setCustomId('verify:captcha').setTitle('Verify — quick check');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('verify:answer')
      .setLabel(challenge.question)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10),
  ));
  return interaction.showModal(modal);
}

async function answerCaptcha(interaction) {
  const pending = pendingChallenges.get(interaction.user.id);
  if (!pending || pending.expiresAt < Date.now() || pending.guildId !== interaction.guildId) {
    pendingChallenges.delete(interaction.user.id);
    return interaction.reply({ embeds: [errorEmbed('Challenge expired', 'Click the Verify button again to get a new question.')], flags: MessageFlags.Ephemeral });
  }
  pendingChallenges.delete(interaction.user.id);
  const given = interaction.fields.getTextInputValue('verify:answer').trim();
  if (given !== pending.answer) {
    await logVerification(interaction.guildId, interaction.user.id, 'captcha', 'failed');
    return interaction.reply({ embeds: [errorEmbed('Wrong answer', `That wasn't right — the answer was **${pending.answer}**. Click Verify again to try a new question.`)], flags: MessageFlags.Ephemeral });
  }
  const result = await grantVerification(interaction.member, 'captcha');
  if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not verify', result.reason)], flags: MessageFlags.Ephemeral });
  return interaction.reply({ embeds: [successEmbed('Verified!', `✅ You're verified — the **${result.role.name}** role was granted. Welcome!`)], flags: MessageFlags.Ephemeral });
}

module.exports = {
  makeMathChallenge, verifyPanelComponents, grantVerification, logVerification,
  onMemberJoin, openCaptchaModal, answerCaptcha, pendingChallenges,
};
