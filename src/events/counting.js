// Counting game messages (see src/utils/counting.js for the rules).
const { Events } = require('discord.js');
const { handleCountingMessage } = require('../utils/counting');
const db = require('../utils/database');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    const result = await handleCountingMessage(message).catch(() => 'ignored');
    // Per-user correct-count tracking (1.13.6): count each valid count.
    if (result === 'counted' && db.isEnabled()) {
      await db.query(
        'INSERT INTO counting_counts (guild_id, user_id, correct_counts) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE correct_counts = correct_counts + 1',
        [message.guildId, message.author.id],
      ).catch(() => {});
    }
  },
};
