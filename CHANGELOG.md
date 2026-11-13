# Changelog

All notable changes to Ace's Discord Bot are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The version
in `package.json` is the source of truth for the current release — every
version below must match a `package.json` version, and the dashboard
`/version` page renders from this file.

## [1.12.6] - 2026-11-13

### Added
- Economy robbery (1.12.6) — `/rob @user` steals from another member's **wallet** (never the bank) at a flat 35% success chance; success takes 10–30% of the victim's wallet (min 10, max 1,000 coins), failure costs the robber a fine of up to 100 coins paid to the victim, capped at what the robber can afford (never a debt). Cooldowns: 30 minutes after a success, 1 hour after a failure (`rob_attempts` table). Guards: no robbing bots or yourself, victim needs 50+ wallet coins; the victim gets a DM when possible. Per-server toggle (`guild_settings.robbery_enabled`, default on) plus a recent-robs list on the dashboard Economy tab. Logged as `rob_win` / `rob_loss` / `rob_fine` in `economy_transactions`.

## [1.12.5] - 2026-11-13

### Added
- New-member link block (1.12.5) — members who joined less than N days ago (default 7) cannot post links: the message is deleted, they get a warning that deletes itself after 10 seconds, and the block is logged to Automod actions. Runs independently of the main Automod toggle; staff roles and Automod-exempt roles/channels bypass it. `/newmemberlinks-setup` (admin) and the dashboard Automod tab. Settings in `guild_settings` (`new_member_link_enabled`, `new_member_link_days`).

## [1.12.4] - 2026-11-13

### Added
- Giveaway bonus entries (1.12.4) — `/giveaway start` takes optional `bonus_role` + `bonus_entries` (default 1, max 10); holders of that role get +N entries, and Nitro boosters get +1 automatically when the guild has a booster role configured. The draw is now **weighted** by total entries (`pickWeightedWinners`), and a winner's tickets are removed after winning so nobody wins twice in one draw. Entry confirmations show `Entries: N (includes X bonus)` with the reasons. Bonus entries live in the `giveaway_bonus` table; the giveaway embed, `/giveaway list`, and the dashboard Giveaways tab show the bonus rules.

## [1.12.3] - 2026-11-13

### Added
- Work job upgrades (1.12.3) — per-server job catalog (`work_jobs` table, chosen job in `user_jobs`): Dishwasher (30–80 coins, free, level 0), Barista (50–120, 200 coins, level 2), Mechanic (80–200, 500 coins, level 5), Developer (150–400, 1,500 coins, level 10), seeded on first use. `/jobs` lists them, `/job buy <name>` unlocks one (wallet coins + level requirement), `/job set <name>` picks an unlocked job. `/work` pays from your job's payout range with that job's flavor text (no job = the old 50–250 range). Dashboard Economy tab lists the server's jobs.

## [1.12.2] - 2026-11-13

### Added
- Nitro booster role (1.12.2) — `/boosterrole set <role>` (admin) picks the role Nitro boosters get automatically: granted when a member starts boosting, removed when they stop, with a one-time sweep granting it to current boosters on setup. `/boosterrole view` / `/boosterrole remove`. Guard: the role must sit below the bot's highest role. Stored in `guild_settings.booster_role_id`; dashboard Roles tab has the dropdown.

## [1.12.1] - 2026-11-13

### Added
- 24/7 music mode (1.12.1) — `/247 enable <voice channel>` (admin) keeps the bot in that voice channel around the clock: it stays connected even with an empty queue and rejoins if disconnected or kicked. `/247 disable` turns it off (the bot leaves); `/247 status` shows the state. A per-minute checker rejoins dropped connections. Settings in `guild_settings` (`music247_enabled`, `music247_channel_id`); dashboard Music tab has the toggle + channel dropdown. Rejoins are logged via the error logger (info level).

## [1.11.6] - 2026-11-13

### Added
- Invite-based auto-roles (1.11.6) — extends the invite tracker: `/inviterole add <invite_code> <role>` (admin) maps an invite code to a role, and members who join through that invite get the role automatically. The role is based on the code used, not the inviter. Guards: the code must be a real active invite in the guild (validated on add) and the role must sit below the bot's highest role. `/inviterole list` and `/inviterole remove <invite_code>` manage the rules (`invite_role_rules` table). Dashboard Invites tab has the code → role rules list with add/remove.

## [1.11.5] - 2026-11-13

### Added
- Multi-ticket panels (1.11.5) — multiple ticket panels per guild, each with its own category, staff role, and topic. `/ticket-panel create <title> <category> [staff_role] [channel] [description]` (admin) posts a new panel; `/ticket-panel list` (admin) shows every panel with its category; `/ticket-panel delete <id>` (admin) removes one. The existing `/ticket-setup` stays as the default/first panel. Tickets opened from any panel record which panel they came from (`tickets.panel_id`, added by migration; the bot falls back to the default panel if the column doesn't exist yet). Dashboard Tickets tab lists panels with create/delete.

## [1.11.4] - 2026-11-13

### Added
- Prestige levels (1.11.4) — extends leveling: at the max level (`config.json leveling.maxLevel`, default 100) a member can run `/prestige` — a confirm-button flow, since it resets level to 1 and XP to 0 — and gains +1 prestige. Each prestige grants a permanent +10% XP multiplier, capped at +100% (prestige 10): `multiplier = 1 + min(prestige, 10) × 0.1`. Prestige count is stored in `user_levels.prestige`, a ⭐ prestige badge shows on `/rank` and the rank card, and a configured prestige role (`guild_settings.prestige_role_id`) is granted permanently. `/prestige-leaderboard` shows the top prestige users. Dashboard Leveling tab has the prestige role setting and the prestige leaderboard.

## [1.11.3] - 2026-11-13

### Added
- Countdowns (1.11.3) — `/countdown create <title> <when> [channel]` (admin/staff) posts a countdown embed that updates itself every minute once under 24h is left, every 5 minutes before that. When it hits zero the message is edited to "🎉 \<title\> is here!" and the channel is pinged once. Times accept `in 2h30m`, `in 3d`, or an absolute date like `2026-12-25 18:00`. `/countdown list` shows active countdowns; `/countdown cancel <id>` (admin) cancels one and deletes its message. Stored in the `countdowns` table. Dashboard Events tab (Scheduled) has the list + create/cancel.

## [1.11.2] - 2026-11-13

### Added
- Emoji manager (1.11.2) — `/emoji-add <name> <image_url or attachment>` (admin with Manage Emojis) uploads a custom emoji — validated: PNG/JPG/GIF under 256KB, name 2–32 letters/numbers/underscores, and the server's emoji slot limit is checked first. `/emoji-remove <name>` (admin) and `/emoji-list` (ephemeral, paginated) round it out. Dashboard Emojis tab lists the server's emoji with add (URL field) + remove. Additions and removals are logged to the database (`emoji_logs` table).

## [1.11.1] - 2026-11-13

### Added
- DJ mode for music (1.11.1) — `/dj-setup <role> [enabled] [only_skip]` (admin) turns DJ mode on and picks the DJ role; `/dj` (admin) shows the current settings. When DJ mode is on, only the DJ role + admins can use the control commands (`/skip`, `/stop`, `/pause`, `/resume`, `/filter`, `/queue-clear`); everyone else gets an ephemeral error naming the DJ role. With `only_skip` on (the default), `/play`, `/lyrics`, `/queue` and `/nowplaying` stay open to everyone; with it off, every music command needs the DJ role. DJ mode can't be enabled without a DJ role set. Dashboard Music tab has the role dropdown, the toggle, and a read-only list of which commands are DJ-only.

## [1.10.6] - 2026-11-13

### Added
- Auto-translate (1.10.6) — messages in watched channels are detected and translated into the server's target language (default English) via Google's free unofficial translate endpoint (no API key; unofficial, no SLA, may rate-limit — failures are skipped and logged, never fatal). Language detection is a built-in heuristic (script + common-word matching), no extra dependency. `/translate <text> [to]` for on-demand translation, `/translate-setup` (admin) for channels + target language. Dashboard General tab has the translate settings. Bot messages and commands are never translated.

## [1.10.5] - 2026-11-13

### Added
- Button role menus (1.10.5) — select-menu role pickers, no reactions needed. `/rolemenu create|add|remove|list|delete` (admin, max 25 options per menu — Discord's select limit). Selecting an option toggles the role; the reaction-role requirements (required role / min days in server / min leveling level, 1.2.6) apply here too, with an ephemeral embed naming the missed requirement. Dashboard Roles tab lists menus and their options.

## [1.10.4] - 2026-11-13

### Added
- Member milestones (1.10.4) — round member counts (100, 250, 500, 1000, 2000, 5000, 10000 — configurable in `config.json milestones`) get a celebration embed in a configured channel, and the member who triggers one earns a 100-coin economy bonus. Each milestone fires once per guild (`milestones_hit` table). `/milestones` shows the next milestone with a progress bar; `/milestone-setup` (admin) sets the channel. Dashboard General tab shows milestone settings and the next milestone.

## [1.10.3] - 2026-11-13

### Added
- Economy heist (1.10.3) — group gamble. `/heist <bet>` opens a 60-second lobby (public message with a Join button); success chance is 40% + 10% per extra crew member (cap 90%). Success pays everyone their bet back x2; failure loses the bet. Bets use the wallet balance, min 50 / max 5000 coins (`config.json economy.heistMinBet/heistMaxBet`), 1-hour cooldown per user, all flows logged in `economy_transactions` (`heist_bet` / `heist_win`).

## [1.10.2] - 2026-11-13

### Added
- Daily trivia challenge (1.10.2) — one server-wide question per day, posted automatically at a configured hour (default 12:00 UTC) in a configured channel. Same question for the whole server (seeded by date + guild id), first correct answer wins 50 coins + a trivia point. Reuses the existing `src/data/trivia.json` bank — no second question bank. `/trivia-daily play` (answer today's), `/trivia-daily setup` (admin: channel + hour), `/trivia-leaderboard`. Dashboard Games tab has the settings and leaderboard.

## [1.10.1] - 2026-11-13

### Added
- Saved music playlists (1.10.1) — `/playlist save <name>` saves the current queue (playing track + queued tracks) as a named playlist, `/playlist load <name>` queues it back (voice channel required), `/playlist list [user]`, `/playlist delete`, `/playlist rename`. Per-user, per-server; max 10 playlists per user per server, max 50 tracks each. Dashboard Music tab lists playlists with delete.

## [1.9.6] - 2026-11-13

### Added
- Anti-nuke protection (1.9.6) — rolling-60s destructive-action counting (channel/role deletes, channel-create bursts, bans, kicks) with configurable threshold (default 5) and kick/ban/lockdown actions, role whitelist, owner DM + log-channel alerts, and audit records in `antinuke_events`. Detection is best-effort via the guild audit log, which can lag — the bot acts after the fact and cannot prevent the first deletions. New guild settings `antinuke_enabled`, `antinuke_action`, `antinuke_threshold`, `antinuke_log_channel_id`, `antinuke_whitelist_roles`. Dashboard Staff → Anti-Nuke page: per-server settings, whitelist, recent-events table.

## [1.9.5] - 2026-11-13

### Added
- Server rules embed (1.9.5) — `/rules-setup <channel>` (admin) opens a modal for a rules title and rules text and posts a single rules embed in the chosen channel; `/rules` (anyone) shows the current rules in an ephemeral embed; `/rules-edit` (admin) opens a prefilled modal and edits the posted message in place. Re-running setup edits the existing message instead of posting a duplicate — one rules message per guild, stored in the new `server_rules` table (`guild_id`, `title`, `content`, `channel_id`, `message_id`, `updated_at`). Dashboard General tab: rules editor with title, rules text, channel picker, and live preview.

## [1.9.4] - 2026-11-13

### Added
- Weekly economy lottery (1.9.4) — `/lottery buy [n1 n2 n3]`, `/lottery status`, `/lottery winners`: one ticket per user per week (default 100 coins from the wallet, 3 numbers 1–30 or random), jackpot = 50% of weekly ticket sales split between 3-match winners, 100-coin consolation for 2 matches. Draws run Sundays at 20:00 server time with results posted to the configured lottery channel and winners DM'd. New tables `lottery_tickets` / `lottery_draws`; new guild settings `lottery_ticket_price`, `lottery_channel_id`. Dashboard Economy tab: lottery status + recent draws.

## [1.9.3] - 2026-11-13

### Added
- Welcome DM (1.9.3) — new members can now also receive a private welcome DM. `/welcome-dm set <message>` (admin) sets the DM template (placeholders `{user}` `{username}` `{server}`) and enables DMs; `/welcome-dm toggle <enabled>` turns them on/off. Both replies are ephemeral and show a rendered preview. Settings live in new `guild_settings` columns (`welcome_dm_enabled`, `welcome_dm_message`). If a member's DMs are closed the DM is skipped silently and logged — the join flow never breaks. Dashboard Welcome tab: DM message field, toggle, and a test button that DMs the admin a preview.

## [1.9.2] - 2026-11-13

### Added
- Purge by user / purge contains (1.9.2) — `/purge <amount> [user] [contains]` — filtered message deletion (by user, by text, or both), on top of the existing unfiltered `/clear`. Pinned messages are skipped, messages older than 14 days are skipped (Discord bulk-delete limit) and counted separately in the reply, and every purge is audit-logged to the new `purge_logs` table.

## [1.9.1] - 2026-11-13

### Added
- Tempban (1.9.1) — `/tempban @user <duration> [reason] [delete_days]` — temporary bans with durations like `12h`, `7d`, `2w`, `30d`, auto-unbanned by a 5-minute expiry timer (plus once at startup). `/tempban-list` (active tempbans with banned-by, reason, and expiry) and `/tempban-cancel` (admin-only early unban). New `temp_bans` table; expiry processing only unbans users who are still banned and logs failures instead of crashing. Guards against tempbanning the server owner, yourself, or anyone with a higher/equal top role. Dashboard Moderation tab: active tempbans with cancel buttons.

## [1.2.7] - 2026-11-13

### Added
- Weather commands (1.2.7) — `/weather <location>` (temperature, feels-like, condition, humidity, wind, pressure, visibility, sunrise/sunset) and `/forecast <location> [days 1-7]` (high/low, condition, precipitation chance per day), powered by Open-Meteo — free, no API key. Locations accept a city name, ZIP code, or "latitude,longitude". `/weather-set` (admin) stores a per-server default location and units (`guild_settings.default_weather_location`, `weather_units`); imperial (°F/mph) by default, metric (°C/km/h) via an option or the server default. Unknown places and API outages get clear error embeds (failures logged via the error logger, never a crash).

## [1.2.6] - 2026-11-13

### Added
- Reaction roles with requirements (1.2.6) — `/reactionroles-add` now takes optional `required_role`, `min_days`, and `min_level`; members who miss a requirement get an ephemeral embed naming exactly what they missed (required role, days in server, or leveling level). `/reactionroles-list` and the dashboard Reaction Roles tab show each mapping's requirements. Requirements live in new `reaction_roles` columns (`required_role_id`, `min_days_in_server`, `min_level`).

## [1.2.5] - 2026-11-13

### Added
- Birthday system (1.2.5) — `/birthday set <month> <day> [year]` (real-date validation, Feb 29 handled), `/birthday remove`, `/birthday list` (upcoming, with ages); `/birthday-setup` sets the announcement channel and hour (default 9 AM, bot host local time). A daily/hourly checker posts a birthday embed once per user per year (`birthdays` table, `announced_last_year`). Dashboard Birthdays tab with channel/hour settings and the upcoming list.

## [1.2.4] - 2026-11-13

### Added
- Music extras (1.2.4) — `/filter bassboost|nightcore|vaporwave|8d|off` (FFmpeg re-encoding via prism-media; applying a filter restarts the current track with the filter on). `/lyrics [song]` from the free lyrics.ovh API (no key). `/nowplaying` rich embed with progress bar, requester, queue position, and filter status. `/play` now accepts Spotify track links — the track is matched on YouTube via Spotify's public oEmbed endpoint; Spotify audio is never streamed directly, and playlist/album links only match their top YouTube result (documented in the README and wiki).

## [1.2.3] - 2026-11-13

### Added
- Temporary voice channels (1.2.3) — joining a designated "create" voice channel spins up a personal voice channel named after the member (in a chosen category) and moves them in; it is deleted when empty (`temp_channels` table). Owner controls with `/tempvc limit|lock|unlock|rename|kick|claim`. Dashboard Temp VC tab for the create channel and category.

## [1.2.2] - 2026-11-13

### Added
- Counting + bump reminders (1.2.2) — counting game in a configured channel: messages must start with the next number, same user twice in a row or a wrong number deletes the message and resets the count to 0 (`counting_settings` table, `current_count`/`highest_count`). `/counting-setup`, `/counting-reset`. Bump reminders: `!d bump` and DISBOARD bump confirmations are recorded; 2 hours later the bot posts a "Time to bump!" reminder in the configured channel (`bump_settings` table). `/bump-setup`, `/bump` (timer / record a manual bump). Dashboard Counting tab.

## [1.2.1] - 2026-11-13

### Added
- Verification gate (1.2.1) — new members verify before getting the member role. Button mode (click Verify) or captcha mode (click Verify, then answer a quick math question in a modal — image-free captcha, no image generation). `/verify-setup` (channel, role, mode — posts the Verify panel), `/verify-toggle`. New members are DM'd where to verify; grants are logged to `verification_logs`. Dashboard Verification tab.

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
