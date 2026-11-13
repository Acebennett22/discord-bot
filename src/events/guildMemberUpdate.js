// Nitro booster role (1.12.2): grant when a member starts boosting,
// remove when they stop. Ignores bots and members whose boost status
// didn't change.
const { Events } = require('discord.js');
const { syncBoosterRole } = require('../utils/boosterRole');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (newMember.user.bot) return;
    const wasBoosting = Boolean(oldMember.premiumSince);
    const isBoosting = Boolean(newMember.premiumSince);
    if (wasBoosting === isBoosting) return;
    await syncBoosterRole(newMember, wasBoosting, isBoosting).catch(() => {});
  },
};
