// Birthday system: members set month/day (+optional year); once a day the
// bot posts a birthday embed in the announcement channel, once per user
// per year. Times use the bot host's local timezone — see README.
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Pure validation: is (month, day, year?) a real calendar date? Feb 29 is
// allowed (leap birthdays celebrate on Feb 28 in non-leap years — the
// checker handles that).
function isValidBirthday(month, day, year) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  if (year !== null && year !== undefined) {
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) return false;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }
  return day <= DAYS_IN_MONTH[month - 1];
}

// Age on a given date, or null when no birth year was stored.
function ageOn(month, day, year, onDate) {
  if (year === null || year === undefined) return null;
  let age = onDate.getFullYear() - year;
  const hadBirthday = onDate.getMonth() + 1 > month
    || (onDate.getMonth() + 1 === month && onDate.getDate() >= day);
  if (!hadBirthday) age -= 1;
  return age;
}

function isBirthdayToday(row, today) {
  const m = today.getMonth() + 1;
  const d = today.getDate();
  if (row.month === m && row.day === d) return true;
  // Leap-day birthdays celebrate on Feb 28 in non-leap years.
  if (row.month === 2 && row.day === 29 && m === 2 && d === 28) {
    const y = today.getFullYear();
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return !isLeap;
  }
  return false;
}

let started = false;

async function checkBirthdays(client) {
  if (!db.isEnabled()) return;
  const now = new Date();
  const today = now;
  const hour = now.getHours();
  const rows = await db.query(
    'SELECT guild_id, user_id, month, day, year, announced_last_year FROM birthdays',
  ) || [];
  for (const row of rows) {
    if (!isBirthdayToday(row, today)) continue;
    if (row.announced_last_year === today.getFullYear()) continue;
    const settings = await getGuildSettings(row.guild_id).catch(() => null);
    if (!settings?.birthdayChannelId) continue;
    if ((settings.birthdayAnnounceHour ?? 9) !== hour) continue;
    const channel = await client.channels.fetch(settings.birthdayChannelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const age = ageOn(row.month, row.day, row.year, today);
    const ageText = age !== null ? ` — turning **${age}**!` : '!';
    await channel.send({
      content: `<@${row.user_id}>`,
      embeds: [infoEmbed('🎂 Happy birthday!', `🎉 Happy birthday <@${row.user_id}>${ageText}\nEveryone wish them a great day!`)],
    }).catch(() => {});
    // Birthday role (1.6.5): grant the configured role for the day.
    if (settings.birthdayRoleId) {
      const guild = channel.guild;
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      const role = guild.roles.cache.get(settings.birthdayRoleId);
      if (member && role && role.position < guild.members.me.roles.highest.position) {
        await member.roles.add(role).catch(() => {});
        await db.query(
          'INSERT INTO birthday_roles_granted (guild_id, user_id, role_id, granted_on) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)',
          [row.guild_id, row.user_id, role.id, today.toISOString().slice(0, 10)],
        ).catch(() => {});
      }
    }
    await db.query(
      'UPDATE birthdays SET announced_last_year = ? WHERE guild_id = ? AND user_id = ?',
      [today.getFullYear(), row.guild_id, row.user_id],
    );
  }
  // Remove yesterday's birthday roles (roles are for the birthday day only).
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const granted = await db.query('SELECT * FROM birthday_roles_granted WHERE granted_on = ?', [yesterday.toISOString().slice(0, 10)]) || [];
  for (const g of granted) {
    const guild = client.guilds.cache.get(g.guild_id);
    if (!guild) continue;
    const member = await guild.members.fetch(g.user_id).catch(() => null);
    const role = guild.roles.cache.get(g.role_id);
    if (member && role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role).catch(() => {});
    }
    await db.query('DELETE FROM birthday_roles_granted WHERE guild_id = ? AND user_id = ? AND granted_on = ?', [g.guild_id, g.user_id, g.granted_on]).catch(() => {});
  }
}

function startBirthdayChecker(client) {
  if (started) return;
  started = true;
  // Check once an hour; the hour gate in checkBirthdays picks the announce hour.
  setInterval(() => checkBirthdays(client).catch(() => {}), 60 * 60 * 1000);
}

module.exports = { isValidBirthday, ageOn, isBirthdayToday, checkBirthdays, startBirthdayChecker };
