// Premium startup: starts the scheduled-messages + reminders loop once
// the client is ready. Separate from ready.js so premium features don't
// touch the core startup path.
const { Events } = require('discord.js');
const { startScheduler } = require('../utils/scheduler');
const { startPresence } = require('../utils/presence');
const { startBirthdayChecker } = require('../utils/birthdays');
const { startBumpChecker } = require('../utils/bump');
const { startAnalytics } = require('../utils/analytics');
const { startDailyTrivia } = require('../utils/dailyTrivia');
const { startMcWidgetChecker } = require('../utils/mcWidgets');
const { startTempbanTimer } = require('../utils/tempban');
const { startLotteryTimer } = require('../utils/lottery');
const { start247Checker } = require('../utils/music247');
const { startCountdownChecker } = require('../utils/countdowns');
const { startTempRoleChecker } = require('../utils/tempRoles');
const { startThreadArchiveChecker } = require('../utils/threadArchive');
const { startEventChecker } = require('../utils/scheduledEvents');
const { startSlowmodeChecker } = require('../utils/slowmode');
const { startAfkVoiceChecker } = require('../utils/afkVoice');
const { startStatusRoleSweep } = require('../utils/statusRoles');
const { startReengageChecker } = require('../utils/reengage');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    startScheduler(client);
    // Rotating Discord presence (global stats as the bot's status).
    startPresence(client);
    // Birthday announcements (hourly check, announce-hour gate inside).
    startBirthdayChecker(client);
    // Bump reminders (checks every minute, reminds at 2h since last bump).
    startBumpChecker(client);
    // Server analytics: message-count flush + daily snapshots.
    startAnalytics(client);
    // Daily trivia (1.10.2): posts each guild's question at its hour.
    startDailyTrivia(client);
    // Minecraft live status widgets (every 5 min by default).
    startMcWidgetChecker(client);
    // Temporary bans: unban expired tempbans (every 5 min + once at startup).
    startTempbanTimer(client);
    // Weekly economy lottery draw (Sundays 20:00 server-local time).
    startLotteryTimer(client);
    // 24/7 music mode (1.12.1): rejoin configured voice channels, checked every minute.
    start247Checker(client);
    // Countdowns (1.11.3): update live countdown embeds every minute.
    startCountdownChecker(client);
    // Temporary roles: remove expired roles every minute.
    startTempRoleChecker(client);
    // Thread auto-archive: archive inactive threads every 15 minutes.
    startThreadArchiveChecker(client);
    // Event scheduler (1.7.2): 1-hour reminders + "starting now" posts.
    startEventChecker(client);
    // Slowmode presets (1.7.3): apply day/night slowmode every 15 minutes.
    startSlowmodeChecker(client);
    // AFK voice kick + AFK channel auto-create (1.7.4 / 1.8.5): every 5 min.
    startAfkVoiceChecker(client);
    // Custom status roles (1.7.6): 10-minute sweep (presence updates can
    // be missed, so the sweep is the safety net).
    startStatusRoleSweep(client);
    // Inactive-member re-engagement (1.8.8): daily job per guild.
    startReengageChecker(client);
  },
};
