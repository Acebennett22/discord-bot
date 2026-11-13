// /kiss (1.13.8): fetches a kiss GIF from the free, no-key nekos.best API
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
    .setName('kiss')
    .setDescription('Give someone a kiss.')
    .addUserOption((o) => o.setName('user').setDescription('Who to kiss').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('An optional message to include').setMaxLength(200)),
  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');
    const url = await fetchNekosGif('kiss');
    if (!url) {
      return interaction.reply({ embeds: [errorEmbed('GIF service unavailable', 'I couldn\'t fetch a kiss GIF from nekos.best right now — please try again in a bit.')], ephemeral: true });
    }
    const embed = infoEmbed(`😘 ${interaction.user.username} kissed ${target.username}!`, message ? `*"${message}"*` : `${interaction.user} kissed ${target}!`)
      .setColor(0xff69b4)
      .setImage(url);
    // Public post: social actions are meant to be seen in the channel.
    return interaction.reply({ embeds: [embed] });
  },
};
