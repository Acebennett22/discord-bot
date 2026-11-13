const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { requireOwner } = require('../../utils/ownerCheck');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Owner only: hot-reload a command file without restarting.')
    .addStringOption((o) => o.setName('command').setDescription('Command name to reload').setRequired(true)),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    const name = interaction.options.getString('command').toLowerCase();
    const existing = interaction.client.commands.get(name);
    if (!existing) return interaction.reply({ embeds: [errorEmbed('Reload failed', `No loaded command named \`/${name}\`.`)] , ephemeral: true });
    // Find the file on disk by scanning the command folders.
    const commandsPath = path.join(__dirname, '..');
    let filePath = null;
    for (const folder of fs.readdirSync(commandsPath)) {
      const folderPath = path.join(commandsPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;
      const candidate = path.join(folderPath, `${name}.js`);
      if (fs.existsSync(candidate)) { filePath = candidate; break; }
    }
    if (!filePath) return interaction.reply({ embeds: [errorEmbed('Reload failed', `Could not find the file for \`/${name}\` on disk.`)], ephemeral: true });
    try {
      delete require.cache[require.resolve(filePath)];
      const fresh = require(filePath);
      if (!fresh?.data?.name || typeof fresh.execute !== 'function') throw new Error('File does not export { data, execute }.');
      interaction.client.commands.set(fresh.data.name, fresh);
      return interaction.reply({ embeds: [successEmbed('Command reloaded', `\`/${name}\` was reloaded from \`${path.relative(process.cwd(), filePath)}\`. Note: slash-command *definitions* still need \`npm run deploy\` to update on Discord.`) ] });
    } catch (err) {
      return interaction.reply({ embeds: [errorEmbed('Reload failed', `\`${err.message}\``)], ephemeral: true });
    }
  },
};
