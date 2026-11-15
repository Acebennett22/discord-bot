const fs = require('fs');
const os = require('os');
const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { requireOwner } = require('../../utils/ownerCheck');
const { logWarn } = require('../../utils/errorLogger');

// Owner-only: host specs are sensitive (no hostname, IPs, paths or usernames).
// Every stat is read defensively — one unreadable stat shows as
// "unavailable" instead of failing the whole command.

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unavailable';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatUptime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unavailable';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    logWarn(`hostinfo: could not read ${label}`, { commandName: 'hostinfo', error: err.message });
    return 'unavailable';
  }
}

function readDistro() {
  if (os.platform() !== 'linux') return null;
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf8');
    const get = (key) => {
      const m = text.match(new RegExp(`^${key}=["']?([^"'\n]+)["']?`, 'm'));
      return m ? m[1] : null;
    };
    return get('PRETTY_NAME') || [get('NAME'), get('VERSION_ID')].filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('hostinfo').setDescription('Owner only: show the host machine specs (OS, CPU, memory, disk, runtime).'),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;

    const distro = safe('distro', readDistro);
    const osLine = safe('os', () => {
      const base = `${os.platform()} ${os.release()} ${os.arch()}`;
      return distro ? `${base} (${distro})` : base;
    });

    const cpuLine = safe('cpu', () => {
      const cpus = os.cpus();
      const model = cpus?.[0]?.model?.trim() || 'Unknown CPU';
      const load = os.loadavg().map((n) => n.toFixed(2)).join(' / ');
      return `${model}\n${cpus.length} cores · Load avg (1/5/15m): ${load}`;
    });

    const memoryLine = safe('memory', () => {
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      const pct = total ? ((used / total) * 100).toFixed(1) : '0.0';
      const mem = process.memoryUsage();
      return `Total: ${formatBytes(total)} · Used: ${formatBytes(used)} (${pct}%) · Free: ${formatBytes(free)}\nBot process: RSS ${formatBytes(mem.rss)} · Heap ${formatBytes(mem.heapUsed)}`;
    });

    const diskLine = safe('disk', () => {
      if (typeof fs.statfsSync !== 'function') throw new Error('statfsSync not available');
      const s = fs.statfsSync(process.cwd());
      const total = s.bsize * s.blocks;
      const free = s.bsize * s.bfree;
      const used = total - free;
      const pct = total ? ((used / total) * 100).toFixed(1) : '0.0';
      return `Total: ${formatBytes(total)} · Used: ${formatBytes(used)} (${pct}%) · Free: ${formatBytes(free)}`;
    });

    const shardId = interaction.client.shard?.ids?.[0];
    const runtimeLine = safe('runtime', () => {
      const uptime = interaction.client.uptime ?? process.uptime() * 1000;
      return `Node.js ${process.version}\nBot uptime: ${formatUptime(uptime)} · Shard: ${shardId ?? 'unsharded'} · PID: ${process.pid}`;
    });

    return interaction.reply({
      embeds: [infoEmbed('Host specs', 'Specs for the machine running this bot.', [
        { name: '🖥️ Operating system', value: osLine, inline: false },
        { name: '⚙️ CPU', value: cpuLine, inline: false },
        { name: '🧠 Memory', value: memoryLine, inline: false },
        { name: '💾 Disk', value: diskLine, inline: false },
        { name: '🚀 Runtime', value: runtimeLine, inline: false },
      ])],
    }).catch(async (err) => {
      await logWarn('hostinfo: failed to send reply', { commandName: 'hostinfo', error: err.message });
      return interaction.reply({ embeds: [errorEmbed('Host info failed', 'Could not send the host specs right now.')] }).catch(() => {});
    });
  },
};
