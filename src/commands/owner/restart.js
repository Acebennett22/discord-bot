const { SlashCommandBuilder } = require('discord.js');
const { requireOwner } = require('../../utils/ownerCheck');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('restart').setDescription('Owner only: restart this shard/bot.'),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    await interaction.reply({ embeds: [infoEmbed('Restarting', '🔄 Restarting… I\'ll be right back.')], ephemeral: true });
    // Give the reply a moment to send before tearing down.
    setTimeout(async () => {
      try {
        if (interaction.client.shard) {
          // Sharded: respawn just this shard; the ShardingManager keeps the rest up.
          await interaction.client.shard.respawn();
        } else {
          // Unsharded: destroy the client and exit — a process manager
          // (pm2, systemd, Docker restart policy) should bring it back.
          // Without one, the bot stays down until started again manually.
          const db = require('../../utils/database');
          await db.closePool().catch(() => {});
          await interaction.client.destroy();
          console.log('[restart] Unsharded restart requested — exiting. Start the bot again (or use a process manager for auto-restart).');
          process.exit(0);
        }
      } catch (err) {
        console.error('[restart] failed:', err.message);
      }
    }, 1000);
  },
};
