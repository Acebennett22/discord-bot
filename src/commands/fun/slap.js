// /slap (1.13.8): fetches a slap GIF from the free, no-key nekos.best API
// and posts it as a PUBLIC embed. API failures get a clear error embed,
// never a crash.
const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');

async function fetchNekosGif(action) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://nekos.best/api/v2/${action}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slap')
    .setDescription('Slap someone (playfully).')
    .addUserOption((o) => o.setName('user').setDescription('Who to slap').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('An optional message to include').setMaxLength(200)),
  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');
    const url = await fetchNekosGif('slap');
    if (!url) {
      return interaction.reply({ embeds: [errorEmbed('GIF service unavailable', 'I couldn\'t fetch a slap GIF from nekos.best right now — please try again in a bit.')], ephemeral: true });
    }
    const embed = infoEmbed(`👋 ${interaction.user.username} slapped ${target.username}!`, message ? `*"${message}"*` : `${interaction.user} slapped ${target}!`)
      .setColor(0xffa500)
      .setImage(url);
    // Public post: social actions are meant to be seen in the channel.
    return interaction.reply({ embeds: [embed] });
  },
};
