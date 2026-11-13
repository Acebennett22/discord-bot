// Invite rewards (1.8.4): when a member's valid invite count reaches a
// configured milestone, they automatically get the reward (a role, or coins
// in their economy wallet). Each milestone grants once per user.
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { addCoins } = require('./economy');
const { successEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

async function getInviteRewards(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM invite_rewards WHERE guild_id = ? ORDER BY invites_required', [guildId])) || [];
}

async function addInviteReward(guildId, invitesRequired, rewardType, roleId, coins, createdBy) {
  await db.query(
    'INSERT INTO invite_rewards (guild_id, invites_required, reward_type, role_id, coins, created_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE reward_type = VALUES(reward_type), role_id = VALUES(role_id), coins = VALUES(coins)',
    [guildId, invitesRequired, rewardType, roleId || null, coins || null, createdBy],
  );
}

async function removeInviteReward(guildId, invitesRequired) {
  const res = await db.query('DELETE FROM invite_rewards WHERE guild_id = ? AND invites_required = ?', [guildId, invitesRequired]);
  return (res?.affectedRows || 0) > 0;
}

async function checkInviteRewards(guild, inviterId, validInvites) {
  if (!db.isEnabled() || !inviterId) return [];
  const rewards = await getInviteRewards(guild.id);
  const granted = [];
  for (const reward of rewards) {
    if (validInvites < reward.invites_required) continue;
    const already = await db.query(
      'SELECT 1 FROM invite_reward_grants WHERE guild_id = ? AND user_id = ? AND invites_required = ?',
      [guild.id, inviterId, reward.invites_required],
    );
    if (already?.length) continue;
    const member = guild.members.cache.get(inviterId) || await guild.members.fetch(inviterId).catch(() => null);
    if (!member) continue;
    let ok = false;
    let description = '';
    if (reward.reward_type === 'role' && reward.role_id) {
      const role = guild.roles.cache.get(reward.role_id);
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role, `Invite reward: ${reward.invites_required} invites`).catch(() => {});
        ok = true;
        description = `the **${role.name}** role`;
      } else if (role) { ok = true; description = `the **${role.name}** role (already had it)`; }
    } else if (reward.reward_type === 'coins' && reward.coins) {
      await addCoins(guild.id, inviterId, reward.coins, 'invite_reward', `Invite reward: ${reward.invites_required} invites`).catch(() => {});
      ok = true;
      description = `**${reward.coins} coins**`;
    }
    if (!ok) continue;
    await db.query(
      'INSERT INTO invite_reward_grants (guild_id, user_id, invites_required) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE granted_at = CURRENT_TIMESTAMP',
      [guild.id, inviterId, reward.invites_required],
    );
    granted.push({ reward, description });
    // DM the member + post in the invite log channel if set.
    await member.send({ embeds: [successEmbed('🎉 Invite reward!', `You reached **${reward.invites_required} valid invites** in **${guild.name}** and earned ${description}!`)] }).catch(() => {});
    const settings = await getGuildSettings(guild.id).catch(() => null);
    if (settings?.inviteLogChannelId) {
      const channel = guild.channels.cache.get(settings.inviteLogChannelId)
        || await guild.channels.fetch(settings.inviteLogChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [successEmbed('🎉 Invite reward!', `<@${inviterId}> reached **${reward.invites_required} valid invites** and earned ${description}!`)] }).catch(() => {});
      }
    }
  }
  return granted;
}

async function nextInviteReward(guildId, validInvites) {
  const rewards = await getInviteRewards(guildId);
  return rewards.find((r) => r.invites_required > validInvites) || null;
}

module.exports = { getInviteRewards, addInviteReward, removeInviteReward, checkInviteRewards, nextInviteReward };
