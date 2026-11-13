const { Events } = require('discord.js');
const { getGuildSettings } = require('../utils/guildSettings');
const db = require('../utils/database');
const { scheduleUpdate } = require('../utils/serverStats');
const { infoEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // Welcome channel comes from per-guild settings (/setup), falling back to
    // the legacy welcomeChannelId in config.json. Unset = no welcome message.
    const settings = await getGuildSettings(member.guild.id);
    const channelId = settings.welcomeChannelId;
    if (channelId) {
      const channel = member.guild.channels.cache.get(channelId)
        || await member.guild.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [infoEmbed(`👋 Welcome to ${member.guild.name}!`, `${member} — you're member #${member.guild.memberCount}.`)] }).catch(() => {});
      }
    }
    await db.incrementMembersJoined(member.guild.id);
    scheduleUpdate(member.guild);
  },
};
