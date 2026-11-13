// Starboard: when a message collects enough reactions of the configured
// star emoji, it gets posted to the starboard channel as an embed. The
// count updates as stars arrive; if it drops below threshold the
// starboard post is deleted (the DB row is kept, marked removed).
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const { getPremiumSettings } = require('./premiumSettings');

function starboardEmbed(message, count, emoji) {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription(message.content?.slice(0, 4000) || '*[no text]*')
    .addFields([
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Stars', value: `${emoji} ${count}`, inline: true },
    ])
    .setTimestamp(message.createdAt)
    .setFooter({ text: 'Starboard' });
  const image = message.attachments?.find((a) => a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.url || ''));
  if (image) embed.setImage(image.url);
  return embed;
}

async function handleStarChange(reaction, user, client) {
  try {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const message = reaction.message;
    if (message.partial) await message.fetch().catch(() => null);
    if (!message.guild || message.author?.bot) return;
    const settings = await getPremiumSettings(message.guild.id);
    if (!settings.starboardChannelId) return;
    if (message.channelId === settings.starboardChannelId) return; // never star the starboard itself
    if (reaction.emoji.name !== settings.starboardEmoji && reaction.emoji.toString() !== settings.starboardEmoji) return;

    // Image-only starboard (1.7.5): messages with image/video attachments go
    // to a separate channel (with the image large) when one is configured;
    // otherwise they go to the main starboard as before.
    let targetChannelId = settings.starboardChannelId;
    let threshold = settings.starboardThreshold;
    const hasMedia = message.attachments?.some((a) => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov)$/i.test(a.url || ''));
    if (hasMedia) {
      const { getGuildSettings } = require('./guildSettings');
      const gs = await getGuildSettings(message.guild.id).catch(() => null);
      if (gs?.imageStarboardChannelId) {
        if (message.channelId === gs.imageStarboardChannelId) return;
        targetChannelId = gs.imageStarboardChannelId;
        threshold = gs.imageStarboardThreshold ?? 3;
      }
    }

    const starboardChannel = message.guild.channels.cache.get(targetChannelId)
      || await message.guild.channels.fetch(targetChannelId).catch(() => null);
    if (!starboardChannel?.isTextBased()) return;

    const count = reaction.count || 0;
    const rows = await db.query('SELECT * FROM starboard WHERE guild_id = ? AND message_id = ?', [message.guild.id, message.id]);
    const row = rows?.[0];

    if (count >= threshold) {
      const jump = `https://discord.com/channels/${message.guild.id}/${message.channelId}/${message.id}`;
      let existingMsg = null;
      if (row && row.starboard_message_id && !row.removed) {
        existingMsg = await starboardChannel.messages.fetch(row.starboard_message_id).catch(() => null);
      }
      if (existingMsg) {
        // Update the existing starboard post's count.
        try {
          await existingMsg.edit({ content: `${settings.starboardEmoji} **${count}** — [jump to message](${jump})`, embeds: [starboardEmbed(message, count, settings.starboardEmoji)] });
        } catch {}
        await db.query('UPDATE starboard SET star_count = ?, removed = 0 WHERE id = ?', [count, row.id]);
      } else {
        // New starboard post.
        const sent = await starboardChannel.send({
          content: `${settings.starboardEmoji} **${count}** — [jump to message](${jump})`,
          embeds: [starboardEmbed(message, count, settings.starboardEmoji)],
        }).catch(() => null);
        if (!sent) return;
        if (row) await db.query('UPDATE starboard SET starboard_message_id = ?, star_count = ?, removed = 0 WHERE id = ?', [sent.id, count, row.id]);
        else await db.query('INSERT INTO starboard (guild_id, message_id, channel_id, starboard_message_id, star_count) VALUES (?, ?, ?, ?, ?)',
          [message.guild.id, message.id, message.channelId, sent.id, count]);
      }
    } else if (row && row.starboard_message_id && !row.removed) {
      // Dropped below threshold — remove the starboard post, keep the row.
      try {
        const sbMsg = await starboardChannel.messages.fetch(row.starboard_message_id).catch(() => null);
        if (sbMsg) await sbMsg.delete().catch(() => {});
      } catch {}
      await db.query('UPDATE starboard SET star_count = ?, removed = 1 WHERE id = ?', [count, row.id]);
    } else if (row) {
      await db.query('UPDATE starboard SET star_count = ? WHERE id = ?', [count, row.id]);
    }
  } catch (err) {
    // Starboard must never break message flow — log and move on.
    const { logWarn } = require('./errorLogger');
    await logWarn('starboard: failed to handle star change', { error: err.message }).catch(() => {});
  }
}

module.exports = { handleStarChange, starboardEmbed };
