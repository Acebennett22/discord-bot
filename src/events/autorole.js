// Auto-role + sticky roles.
// On join: give the configured auto-role, then restore any saved sticky
// roles (only roles that still exist and the bot can assign). On leave:
// save the member's assignable roles (if sticky roles are enabled).
const { Events } = require('discord.js');
const db = require('../utils/database');
const { getPremiumSettings } = require('../utils/premiumSettings');

module.exports = [
  {
    name: Events.GuildMemberAdd,
    async execute(member) {
      try {
        const settings = await getPremiumSettings(member.guild.id);
        const toAdd = [];
        if (settings.autoroleId) toAdd.push(settings.autoroleId);
        if (settings.stickyRolesEnabled && db.isEnabled()) {
          const rows = await db.query('SELECT roles FROM sticky_roles WHERE guild_id = ? AND user_id = ?', [member.guild.id, member.id]);
          if (rows?.length) {
            let saved = [];
            try { saved = JSON.parse(rows[0].roles); } catch {}
            for (const roleId of saved) {
              if (roleId !== member.guild.id && !toAdd.includes(roleId)) toAdd.push(roleId);
            }
            await db.query('DELETE FROM sticky_roles WHERE guild_id = ? AND user_id = ?', [member.guild.id, member.id]);
          }
        }
        if (!toAdd.length) return;
        const me = member.guild.members.me;
        const usable = toAdd.filter((roleId) => {
          const role = member.guild.roles.cache.get(roleId);
          return role && me && role.position < me.roles.highest.position && !member.roles.cache.has(roleId);
        });
        if (usable.length) await member.roles.add(usable).catch(() => {});
      } catch {}
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      try {
        if (!db.isEnabled()) return;
        const settings = await getPremiumSettings(member.guild.id);
        if (!settings.stickyRolesEnabled) return;
        const me = member.guild.members.me;
        const roles = [...member.roles.cache.values()]
          .filter((r) => r.id !== member.guild.id && (!me || r.position < me.roles.highest.position))
          .map((r) => r.id);
        if (!roles.length) return;
        await db.query(
          'INSERT INTO sticky_roles (guild_id, user_id, roles) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE roles = VALUES(roles), saved_at = NOW()',
          [member.guild.id, member.id, JSON.stringify(roles)],
        );
      } catch {}
    },
  },
];
