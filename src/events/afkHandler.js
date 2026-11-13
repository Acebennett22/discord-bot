// AFK system (MessageCreate). If someone mentions an AFK user, the bot
// notes it (once per message, small embed). When the AFK user sends any
// message, their AFK status clears and they get a one-time welcome back.
const { Events } = require('discord.js');
const db = require('../utils/database');
const { infoEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !db.isEnabled()) return;
    try {
      // Returning user: clear AFK + welcome back + revert nickname.
      const self = await db.query('SELECT reason, since FROM afk_users WHERE guild_id = ? AND user_id = ?', [message.guild.id, message.author.id]);
      if (self?.length) {
        await db.query('DELETE FROM afk_users WHERE guild_id = ? AND user_id = ?', [message.guild.id, message.author.id]);
        try {
          const nick = message.member?.nickname;
          if (nick?.startsWith('[AFK] ')) await message.member.setNickname(nick.replace(/^\[AFK\] /, '').slice(0, 32) || null);
        } catch {}
        await message.reply({ embeds: [successEmbed('Welcome back', `${message.author.username} is back${self[0].reason ? ` — was away: **${self[0].reason}**` : ''}.`)] }).catch(() => {});
        return; // don't also report them as AFK to themselves
      }

      // Mentions of AFK users.
      if (!message.mentions.users.size) return;
      const ids = [...message.mentions.users.keys()];
      const placeholders = ids.map(() => '?').join(',');
      const afkRows = await db.query(
        `SELECT user_id, reason, since FROM afk_users WHERE guild_id = ? AND user_id IN (${placeholders})`,
        [message.guild.id, ...ids],
      ) || [];
      if (!afkRows.length) return;
      const lines = afkRows.map((r) => {
        const since = Math.floor(new Date(r.since).getTime() / 1000);
        return `<@${r.user_id}> is AFK since <t:${since}:R>${r.reason ? ` — **${r.reason}**` : ''}`;
      });
      await message.reply({ embeds: [infoEmbed('💤 AFK', lines.join('\n'))] }).catch(() => {});
    } catch {}
  },
};
