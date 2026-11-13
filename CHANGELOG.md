# Changelog

All notable changes to Ace's Discord Bot are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The version
in `package.json` is the source of truth for the current release — every
version below must match a `package.json` version, and the dashboard
`/version` page renders from this file.

## [1.1.2] - 2026-11-13

### Added
- Fancy dashboard redesign — glassmorphism cards, sidebar layout, Inter font, toggle switches, hover-lift server cards.
- Staff area on the dashboard — bot overview, global command/feature toggles, staff management, owner broadcast, errors page, backups page.
- Streams management on the dashboard — add/edit/remove/refresh watched streamers; live-channel name that renames to say a streamer is live and restores the original name when they go offline; per-server live-channel name template stored in MySQL (`{name}`, `{game}`, `{title}`), editable on the dashboard or with `/stream-template`.
- Applications (Appy-style) — `/application-create`, `/apply`, review channel with Accept/Deny buttons, role grant + DM on decision, dashboard review queue.
- Invite tracker — who invited who, leaves, fake-account flagging, vanity URL joins, leaderboard, dashboard tab.
- Error logging for staff — every error/warn into the `error_logs` table (backfilled from file if MySQL is down), `/errors`, `/error <id>`, dashboard Staff → Errors page.
- Daily database backups — 3 AM, 30-day retention, `/backup`, dashboard Staff → Backups page with downloads, restore script.
- Config key links — every API key in `config.json` has its official "get it here" link next to it.
- First-run setup wizard (NamelessMC-style) — 8 steps with test-connection buttons, reachable through a domain via a one-time setup token, plus Nginx reverse-proxy support (`deploy/nginx/`).
- GitHub repo — private `Acebennett22/discord-bot`.
- `/hostinfo` (owner-only) — host OS/CPU/memory/disk/runtime specs.
- `/announce` (admin) — announcement embeds with color, image, footer, role ping, and plain-text mode.
- Welcome & goodbye messages — templated join/leave embeds (`{user}`, `{username}`, `{server}`, `{membercount}`), dashboard Welcome tab.
- Automod — spam detection, banned-words filter, link/invite blocking, exempt roles/channels, dashboard Automod tab.
- Suggestions — `/suggest` with 👍/👎 voting (one vote per user), staff Approve/Deny/Implement, dashboard Suggestions tab.
- Economy — `/balance`, `/daily`, `/work`, `/pay`, `/eco-leaderboard`, `/shop`, `/shop-add`, `/deposit`, `/withdraw`; wallet + bank in MySQL, shop roles, dashboard Economy tab.
- Casino — `/slots`, `/blackjack` (Hit/Stand buttons, 3:2 blackjack), `/roulette`, `/gamble-coinflip`, `/gamble-dice` on the same wallet balance; min bet 10 / max 10,000, 5s cooldown, wins/losses in `economy_transactions`.
- Starboard — starred messages posted to a starboard channel with live counts, dashboard Starboard tab.
- Custom commands — per-server trigger words with stored replies, dashboard Custom Commands tab.
- Message logging (modlog) — deleted/edited messages stored in MySQL and posted to a modlog channel (secrets redacted).
- AFK — `/afk` / `/afk-remove`, mention notices, auto-clear on return, optional `[AFK]` nickname prefix.
- Polls — `/poll` / `/poll-end`, reaction voting with one vote per user and a live tally.
- Auto-role + sticky roles — `/autorole set|remove|view|sticky`, roles saved on leave and restored on rejoin, dashboard Roles tab.
- Scheduled messages & reminders — `/schedule`, `/schedule-list`, `/schedule-cancel`, `/remindme`; stored in MySQL so they survive restarts, dashboard Scheduled tab.
- FAQ auto-responder — trigger phrases (exact or contains) answered in-channel, `/faq-add` / `/faq-remove` / `/faq-list`, dashboard FAQ tab.
- Presence — rotating Discord status with live stats (`{guilds}`, `{users}`, `{commands}`, `{uptime}`, `{version}`), `/presence set|reset|list` (owner), dashboard Staff → Presence section.
- Bot version in `/botstats` and `/status` (read from `package.json`).
- Version/Changelog page on the dashboard (`/version`), rendered from this file.
- Inventory, crates & trading — `/buy`, `/sell`, `/inventory`, `/open-crate`, `/use`, `/trade`, `/trade-cancel`; Common/Rare/Legendary crates with weighted loot, daily item rewards on `/daily`, a 25%-off daily deal per guild, and atomic player-to-player trades (one DB transaction).
- Bot tracking — join scoring (account age, avatar, username patterns, join bursts, creation clustering), flag/kick/ban auto-actions (flag-only by default), `/botflags`, `/botflag`, `/botflag-clear`, `/bottrack`, and a Staff → Bot Tracking dashboard page.
- Wiki/docs page on the dashboard (`/docs`) — getting started, a command reference generated live from the bot's command files, feature guides, FAQ, and client-side search.
- Dashboard JavaScript layer — `dashboard/public/app.js` + per-page modules (`js/settings.js`, `js/staff.js`, `js/setup.js`, `js/docs.js`): fetch-based saves with toasts, immediate toggles, live list refresh, DOM row removal on delete, 30s staff-overview auto-refresh, client-side wizard navigation, live previews, and docs search. EJS server render + plain-POST fallback remain for no-JS browsers.

### Changed
- All slash-command replies are ephemeral — only the public posts a command is meant to make in a channel (polls, announcements, suggestions, FAQ replies) stay public.
- The first-run setup wizard now auto-runs both `sql/schema.sql` and `sql/premium.sql`.
- Premium features (economy, starboard, custom commands, message logs, AFK, polls, auto-role/sticky roles, scheduled messages, FAQ, presence) live in `sql/premium.sql`, separate from `sql/schema.sql`.
- Bot version bumped to 1.1.2.
- Dashboard default port is now 3010 (was 3000) — `config.json` `dashboard.port`, redirect URI, Nginx config, and README updated.

### Fixed
- Setup wizard SQL runner no longer drops the first `CREATE TABLE` in a schema file when the file starts with a header comment.

## [1.0.0] - 2026-11-12

### Added
- Initial release: moderation (`/kick`, `/ban`, `/unban`, `/timeout`, `/warn`, `/clear`), music (`/play`, `/skip`, `/stop`, `/queue`, `/pause`, `/resume` via YouTube), tickets with HTML transcripts, leveling/XP with rank and leaderboard, giveaways, reaction roles, game server status with pluggable providers, stream notifications (Twitch, YouTube, Kick), Steam account linking, server stats channels, multi-server support with sharding, MySQL logging/stats, and a Dyno-style web dashboard with Discord OAuth2.
