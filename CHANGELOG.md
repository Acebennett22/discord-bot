# Changelog

All notable changes to Ace's Discord Bot are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The version
in `package.json` is the source of truth for the current release — every
version below must match a `package.json` version, and the dashboard
`/version` page renders from this file.

## [1.15.4] - 2026-11-15

### Changed
- Persistent dashboard logins (1.15.4) — login sessions are now stored in MySQL (`sessions` table, auto-created by express-mysql-session) instead of in-process MemoryStore, so users stay logged in across dashboard restarts. The login cookie is 30 days (was 24 hours) with `rolling: true`, so active users stay logged in. The new `src/utils/sessionStore.js` lazily picks its backend on first use: MySQL when the database is up, MemoryStore with a console warning when it isn't (the dashboard still boots; sessions just don't persist). The Discord OAuth flow now requests the `offline` scope, so the callback stores a refresh token alongside the access token; the server picker refreshes the access token on 401 (and proactively when it is known-expired) and retries once. If the refresh fails, the user stays logged in — the server picker shows a "Your Discord connection expired — log in again" notice instead of forcing a login, and per-server pages redirect to the picker instead of 500ing. Sessions from before 1.15.4 have no refresh token and take the notice path on their next guilds call. The setup wizard's one-time link is unchanged (the token is still single-use; only the resulting authorized session persists).

## [1.15.3] - 2026-11-15

### Changed
- Analytics leaderboards (1.15.3) — the "Top users by XP" and "Top users by commands used" tables on the dashboard analytics page now show "Name (ID)" instead of literal `<@user_id>` mention text, which the browser rendered as plain text, not a mention. Both lists are resolved with a single `resolveUserLabels` call (same helper as the staff list in 1.15.1; de-duplicated, unresolvable IDs fall back to "ID (unknown user)"). Top channels and daily stats are untouched.

## [1.15.2] - 2026-11-15

### Fixed
- Auto-translate crash (1.15.2) — `settings.channels.includes is not a function` on every message when translate was enabled. The `channels_json` column is MySQL JSON, so mysql2 already returns a parsed value, but the reader ran `JSON.parse` on it anyway: a correct array coerced to `"123,456"`, threw, and silently fell back to `[]` (auto-translate never matched), while a bare stored value came back as a number and `.includes` threw. `getTranslateSettings` now normalizes every shape to an array of string channel IDs (parsed array, JSON string, bare number/string, object, null/invalid → `[]`); bare numeric strings are never JSON-parsed, so snowflake IDs past 2^53 keep full precision. `saveTranslateSettings` normalizes before writing, so a bad shape can never be stored again. No schema change.
- Deprecation warnings (1.15.2) — replaced `fetchReply: true` with `withResponse: true` in the only three call sites (`/ping`, `/help`, `/trivia`), reading the sent message from `response.resource.message`. No behavior change. The `ephemeral` deprecation (1,171 sites) is a separate sweep and is untouched.

## [1.15.1] - 2026-11-15

### Changed
- Staff management page (1.15.1) — /staff/manage rows now show names as well as IDs: the staff member column shows "Name (ID)" and the added-by column shows "Name (ID)" of whoever added them, instead of raw IDs only. Names resolve via the bot REST API (GET /users/{id}; the dashboard is a separate process with no discord.js client), de-duplicated per page render. Unresolvable IDs fall back to "ID (unknown user)" and never crash the page; rows with a NULL added_by (added outside the dashboard) show "System / config". No schema change — staff_users is untouched.

## [1.15.0] - 2026-11-15

### Changed
- Consolidated all 266 slash commands into 37 top-level commands (1.15.0, BREAKING CHANGE — every command name users type changes). Discord caps an app at 100 top-level CHAT_INPUT commands per scope, and single-command deploy failed on command #101 with error 30032, so the 266 flat commands are now grouped by folder into subcommands: one parent per folder (e.g. /ban → /mod ban, /play → /music play, /ticket-setup → /ticket setup), utility split into /utility (21) and /tools (25). Children that already define subcommands became subcommand groups (e.g. /mod warn add, /economy job set). serverbackup, giveaway, and mediathreads stay standalone, as do the two message context-menu commands. The 266 command files were not edited — grouping happens in the new loader src/handlers/consolidate.js at the JSON level, and a parent router looks up the original child module. Permissions are preserved: parents with uniform permissions carry them (/custom, /faq, /starboard, /welcome), and mixed parents enforce each child's original permission at runtime. Feature toggles, mod logging, and command logging keep using flat child names. Autocomplete is now routed too (previously nothing handled it, so /economy job autocomplete was dead). A bulk deploy replaces the whole command list, so the old flat names disappear and the new grouped ones appear.

## [1.14.17] - 2026-11-15

### Fixed
- Deploy single-mode reporting (1.14.17) — a failure in `DEPLOY_MODE=single` used to blame `commands[0]` instead of the command that actually failed; it now names the failing command and how many registered before it. Bulk mode also warns that a bulk deploy replaces the whole list and would remove commands previously registered one-at-a-time.

## [1.14.16] - 2026-11-15

### Fixed
- Leveling SQL crash (1.14.16) — `Unknown column 'messages' in 'field list'`: the leveling code counts every message in `user_levels.messages`, but that column was only ever added by an ALTER note in `sql/schema.sql` — the CREATE TABLE never had it, so even a fresh install was missing it. An audit found 5 such columns; all 5 are now in the CREATE TABLEs (`user_levels.messages`, `user_levels.prestige`, `tickets.panel_id`, `giveaways.bonus_role_id`/`bonus_entries`, `polls.final_counts`), and the bot now self-heals on startup: `initDatabase()` checks INFORMATION_SCHEMA and adds any missing column (plus recreates the `autoresponders` table if the wizard ran before the `trigger` fix), so existing installs are fixed by restarting — no manual SQL needed.

## [1.14.15] - 2026-11-15

### Changed
- Deploy limit (1.14.15) — `npm run deploy` now caps at 100 commands by default (Discord rejects a bulk request much above that, and 100 is the per-scope command cap). The script logs every skipped command by name so it is clear what is not registered. Override with `DEPLOY_LIMIT=0` (no limit) or another number, e.g. `DEPLOY_LIMIT=129 npm run deploy`.

## [1.14.14] - 2026-11-15

### Fixed
- Deploy bisect (1.14.14) — 50 commands deploy fine, 100 deploy fine, 130 fail, so the wall is between 100 and 130 commands in one bulk request, not any command's fields. Added `DEPLOY_MODE=single` to the deploy script: registers commands one at a time (POST each, Discord upserts by name), bypassing the per-request bulk array limit. It still counts toward Discord's 200 new-command creates per day and the 100 CHAT_INPUT per scope, and it stops at the first failure naming the command. Next test: `DEPLOY_LIMIT=129 npm run deploy` — if 129 works, the app cap is not 100 and single-mode can register all 266; if it fails with error 30032, the 100-command cap is real and consolidation into subcommand groups is required.

## [1.14.13] - 2026-11-15

### Fixed
- Deploy still failing with the same `0[BASE_TYPE_MAX_LENGTH]: Must be 130 or fewer in length` after 1.14.12 — the two option-ordering fixes did not change the error, and a full local validation of the payload (every description ≤97 chars, names, options ≤25, choices ≤25, no duplicates, no ordering issues) finds nothing over any documented limit, so the cause is not a command field. The deploy script now prints the raw Discord error and the exact command at index 0 of the sent array, and supports `DEPLOY_LIMIT`/`DEPLOY_OFFSET` to bisect (e.g. `DEPLOY_LIMIT=50 npm run deploy`): if a 50-command slice deploys cleanly, the payload fields are fine and the wall is the request size/count (266 commands vs Discord's 100 global CHAT_INPUT cap); if the slice still fails, the printed index-0 command names the culprit.

## [1.14.12] - 2026-11-15

### Fixed
- Autoresponder SQL crash (1.14.12) — `trigger` is a reserved word in MySQL, so every autoresponder query failed with a syntax error near 'trigger' (and the wizard's auto-run had swallowed the matching CREATE TABLE failure, so the table may not exist yet). The column and all queries now use backticks: `` `trigger` `` in `sql/schema.sql`, `src/commands/utility/autoresponder.js` (INSERT/DELETE/UPDATE) and `src/utils/autoresponders.js` (ORDER BY). If the table is missing, re-run the `autoresponders` CREATE TABLE from `sql/schema.sql`.
- Deploy failures (1.14.12) — two commands had a required option after an optional one, which Discord rejects: `/invite-reset` (`confirm` after `user`) and `/reactionroles-setup` (`title` after `channel`). Required options now come first in both. Added a pre-flight checker (`check-deploy.js`, run with `node check-deploy.js`) and full Discord error output on deploy failure.
- Known deploy limit (1.14.12) — the bot now has 264 slash commands, but Discord allows at most 100 global CHAT_INPUT commands per app, so a global deploy cannot register all of them. Consolidating related commands into subcommand groups is the real fix and is still to be done.

## [1.14.11] - 2026-11-15

### Fixed
- Startup warning (1.14.11) — silenced the `ready` DeprecationWarning: `index.js` listened for the literal `'ready'` client event, which discord.js renamed to `clientReady` (it stops working entirely in v15). Now listens for `Events.ClientReady`. Note: `shard.on('ready')` in `shardManager.js` is intentionally untouched — that is the shard-process event, not the client event.

## [1.14.10] - 2026-11-15

### Fixed
- Setup wizard (1.14.10) — the finish page was unreachable: the `/setup/:step` routes were registered before `/setup/finish`, so Express matched "finish" as a step name, failed to parse it as a number, and bounced the user back to step 1. The finish routes now register first, so step 8 actually reaches the review page and its Save button.

## [1.14.9] - 2026-11-15

### Fixed
- Setup wizard (1.14.9) — step 8 "Review & finish" rendered an empty page with no finish button. The template only shows the review table and "Save config & finish" button on GET /setup/finish, but the wizard sent users to /setup/8, which has no matching template branch. Step 8 now redirects to /setup/finish.

## [1.14.8] - 2026-11-15

### Fixed
- Setup wizard (1.14.8) — removed the setup-only rate limit (10 requests per 15 minutes). It counted every step load and submit, so normal setup use tripped "Too many setup attempts" — including on the MySQL step. The wizard is still gated by its one-time setup token, and the dashboard's general limit (300 requests per 15 minutes) still applies.

## [1.14.7] - 2026-11-15

### Fixed
- Setup wizard (1.14.7) — step forms submitted via `fetch` with `FormData` (multipart), but the server only parses URL-encoded/JSON bodies, so `req.body` arrived empty and every step failed with "required" even when the fields were filled. Steps now submit as URL-encoded. Also fixed the misleading "Step saved" toast firing on failed steps — it only shows when the step actually saved.

## [1.14.6] - 2026-11-15

### Added
- Safety status (1.14.6) — admin-only `/safety-status` shows the server's whole protection state in one read-only embed: Automod + antispam state, content-filter rule counts, member-logging setup, autoresponder count, reaction-role mappings, stream watchers, and Automod actions in the last 24h broken down by action.

## [1.14.5] - 2026-11-15

### Added
- Content filter (1.14.5) — admin-only `/content-filter add|remove|list` blocks words (word-boundary match) and harmful-link domains (hostname + subdomains), each rule with its own action (`delete`/`warn`/`timeout`/`delete_warn`/`delete_timeout`) and severity (`low`/`medium`/`high`) in the new `content_filter_rules` table. Enforced in Automod after the spam detectors, before the legacy banned-words list. No built-in word list ships with the bot — each server defines its own entries. This merges the harmful-content filtering and keyword-protection asks into one system instead of two overlapping lists.

## [1.14.4] - 2026-11-15

### Added
- Antispam detectors (1.14.4) — admin-only `/antispam` adds duplicate-message (same text 3× in 60s, default), ALL-CAPS (70%+ uppercase over 10+ letters, defaults), mention-spam (max 5 mentions, default), and link-count (max links per message, off by default) detection on top of Automod's rate limit. Each detector has its own toggle and thresholds, sharing one `antispam_action` (new columns on `automod_settings`); running `/antispam` with no options shows the current settings. Detectors are pure functions (`detectDuplicate` / `detectCaps` / `countMentions` / `countLinks`) exported from `src/utils/automod.js`.

## [1.14.3] - 2026-11-15

### Added
- Autoresponder (1.14.3) — admin-only `/autoresponder add <trigger> <response> [match] | remove | toggle | list` (`autoresponders` table). Fires when a phrase appears anywhere in a message (`contains`, default) or only when the whole message is the trigger (`exact`) — different from `/custom-add`, which only fires on a single trigger word at the start. Replies run after Automod in `messageCreate` and respect the shared "handled" marker, so a message gets at most one auto reply.

## [1.14.2] - 2026-11-15

### Added
- Member + moderation logging (1.14.2) — admin-only `/logging setup <channel> [joins] [leaves] [bans] [kicks] [timeouts] [roles]` and `/logging status` (`logging_settings` table). Logs joins, leaves, bans/unbans, kicks (told apart from leaves via the audit log — needs View Audit Log), timeouts, and role changes to one log channel. Message deletes/edits stay on the modlog and Automod actions on the Automod log channel.

## [1.14.1] - 2026-11-15

### Added
- Reaction-role pause/resume (1.14.1) — admin-only `/reactionroles-toggle <message_id> <enabled>` pauses or resumes all buttons on one reaction-role message (`reaction_roles.enabled` column). While paused the buttons render disabled and stale clicks get an ephemeral refusal; mappings and requirements are untouched.

## [1.14.0] - 2026-11-15

### Added
- Stream check (1.14.0) — admin-only `/stream-check <platform> <channel>` forces an immediate live check for a watched streamer instead of waiting for the next poll interval. A fresh offline → live transition posts the announcement to the notify channel (embed + latest clip/video, same as the poller); an already-live streamer reports its status without a duplicate post. TikTok/Facebook return the manual-only note — there is no public live API for them, and the bot does not fake one with scraping.

## [1.13.15] - 2026-11-13

### Added
- Emoji steal (1.13.15) — `/steal-emoji <emoji> [name]` copies a custom emoji from another server (or an image URL) into this server, with an optional new name. Requires Manage Emojis; same validation as `/emoji-add` (PNG/JPG/GIF under 256KB, name 2–32 letters/numbers/underscores, emoji slot limit checked first) and logged to `emoji_logs`.

## [1.13.14] - 2026-11-13

### Added
- Temp VC setup command (1.13.14) — admin-only `/tempvc-setup` configures temporary voice channels in Discord (create channel, optional category, on/off) instead of only via the dashboard. Saves the existing `tempvcCreateChannelId` / `tempvcCategoryId` settings; disabling clears the create channel (there is no separate enabled flag).

## [1.13.13] - 2026-11-13

### Added
- Translate context menu (1.13.13) — a "Translate message" message context menu command translates any message into the server's configured auto-translate target language (English by default) and replies ephemerally with the original text and the translation. Uses the same free, no-key Google translate helper as `/translate`; messages already in the target language (or with no text) get a clear ephemeral note instead.

## [1.13.12] - 2026-11-13

### Added
- Weather home location (1.13.12) — `/weather-home set <location>` / `clear` / `view` saves a personal home location per user per server (`user_weather` table). `/weather` with no location now uses your home location first, then the server default from `/weather-set`.

## [1.13.11] - 2026-11-13

### Added
- Custom color roles (1.13.11) — `/color custom <hex>` sets any `#RRGGBB` color: it creates (or recolors) a personal color role named `color-<your user id>`, positioned below the bot's highest role, and wears it like any other color role — one color at a time, so your old color role comes off. Your personal role shows in `/color list`, and `/color remove` deletes it entirely instead of leaving a dead role behind. Personal roles are tracked in the `user_color_roles` table.

## [1.13.10] - 2026-11-13

### Added
- Role shop (1.13.10) — `/roleshop list` shows roles for sale with prices; `/roleshop buy <role>` spends wallet coins for a one-time purchase (refused if you already have the role or already bought it once). `/roleshop add <role> <price>` and `/roleshop remove <role>` are admin-only. The role must sit below the bot's highest role, and it is granted before any coins are taken so a failed grant never charges you; if the purchase record cannot be written, the charge is refunded and the role removed. Listings in `roleshop_items`, purchases in `roleshop_purchases`.

## [1.13.9] - 2026-11-13

### Added
- Daily quests (1.13.9) — `/quest list` shows today's 5 quests with done/claimed state; `/quest claim [quest]` claims one by ID, or all completed ones if omitted. Quests: claim `/daily`, work a shift, use 5 slash commands, spend 10 minutes in voice, play a casino game — each verified at claim time from tables the bot already writes, and each paying coins + XP (50–100 coins, 20–30 XP). One claim per quest per day, tracked in the `user_quests` table.

## [1.13.8] - 2026-11-13

### Added
- Social actions (1.13.8) — `/ship @user [@user2]` (second user defaults to you) gives a deterministic compatibility % — same pair, same score every time (FNV-1a hash of the two user IDs) — as a public embed with a percentage bar and a playful label. `/hug`, `/kiss`, and `/slap @user [message]` fetch a GIF from the free, no-key nekos.best API and post it as a public embed naming actor and target; if the GIF service is down you get a clear error embed instead of a crash. No database use.

## [1.13.7] - 2026-11-13

### Added
- Confessions setup command (1.13.7) — admin-only `/confess-setup` sets the confessions channel, whether staff approval is required (default true), and whether confessions are enabled (default true), and replies with the current setup. Previously these settings could only be changed on the dashboard. Saves via the existing `confessionsEnabled` / `confessionsChannelId` / `confessionsRequireApproval` settings; `/confess` itself (modal submission, approval queue) is unchanged.

## [1.13.6] - 2026-11-13

### Added
- Counting leaderboard (1.13.6) — `/counting-leaderboard` shows the current count, the highest count, and the top 10 counters by correct counts. Per-user correct counts are now tracked on every valid count in the `counting_counts` table (counts start at 0 for everyone — no backfill from past counting history). The counting rules themselves are unchanged.

## [1.13.5] - 2026-11-13

### Added
- Birthday today/next (1.13.5) — `/birthday today` lists members with a birthday today, and `/birthday next` shows the next upcoming birthday in the server and how many days away it is. Reuses the existing `birthdays` table and the Feb 29 handling from the daily checker; set/remove/list, setup, and the birthday role are unchanged.

## [1.13.4] - 2026-11-13

### Added
- Channel lockdown (1.13.4) — `/lockdown lock [channel] [reason]` (moderators, Manage Channels) locks a channel so @everyone cannot send messages — the previous @everyone overwrite is stored and restored exactly on `/lockdown release`, which posts a public unlock notice; `/lockdown status` lists currently locked channels. Lock state lives in the `lockdowns` table. Separate from the anti-nuke system's automatic lockdown action.

## [1.13.3] - 2026-11-13

### Added
- Verify from anywhere (1.13.3) — `/verify` lets a member verify without finding the panel: it reports if they are already verified, otherwise sends them a working Verify button (captcha mode opens the math-question modal, same as the panel), or points them to `/verify-setup` if verification is not enabled. Reuses the existing verification gate and `verificationInteraction` handler; no new table.

## [1.13.2] - 2026-11-13

### Added
- User reports (1.13.2) — `/report submit @user <reason> [evidence]` files a report with the moderators: it is stored in the `reports` table and posted as an embed to the modlog channel configured with `/modlog-setup` (falling back to the core log channel). `/report list` (Manage Messages) shows open reports. Self-reports and bot reports are refused.

## [1.13.1] - 2026-11-13

### Added
- AFK list (1.13.1) — `/afk-list` shows an ephemeral embed of everyone currently AFK in the server, with their reason and how long they have been away. Reads the existing `afk_users` table written by `/afk`; the mention notices, auto-clear on return, and nickname prefix are unchanged.

## [1.13.0] - 2026-11-13

### Added
- Reminder management (1.13.0) — `/remind` with `set`, `list`, and `cancel` subcommands: set a personal reminder (same time formats as `/remindme`), list your pending reminders with IDs and relative due times, or cancel one of your own pending reminders. Delivery still goes through the existing 1-minute scheduler loop (DM, falling back to the channel where it was set); reuses the `reminders` table, no new table.

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

## [1.8.9] - 2026-11-13

### Added
- Rank card image (1.8.9) — `/rank` now posts a 900×300 rank card image (avatar, username, level, XP progress bar, leaderboard rank, total messages) in the same theme as the welcome card, reusing the canvas setup; the text embed is the fallback if canvas fails. Total messages counts every message since this feature was added (`user_levels.messages` — add the column on existing installs: `ALTER TABLE user_levels ADD COLUMN messages INT UNSIGNED NOT NULL DEFAULT 0;`). Dashboard Leveling tab: rank card preview with sample data.

## [1.8.8] - 2026-11-13

### Added
- Inactive-member re-engagement (1.8.8) — `/reengage-setup enable [days] [channel]` (admin) turns on a daily job (10:00) that DMs members inactive for N days (default 30) a friendly "we miss you" message — at most once per member per 30 days, never bots, never members who joined less than N days ago, never members who opted out with `/reengage-optout` (anyone). `/reengage-preview` (admin) shows who would be messaged without sending anything. Activity is read from the data the bot actually records: `user_levels.last_xp_at` (last message that earned XP), `voice_sessions` (last voice session), `user_stats.last_seen` (last slash-command use). Logs in `reengage_logs`, opt-outs in `reengage_optouts`; dashboard Analytics page shows the inactive count and last-run summary.

## [1.8.7] - 2026-11-13

### Added
- Auto-publish announcements (1.8.7) — `/autopublish add|remove|list` (admin) manages announcement channels that auto-publish. Messages posted in a configured announcement channel (type GUILD_ANNOUNCEMENT) are crossposted automatically. Bot messages and already-published messages are skipped; failures go to the error log. Channels in `guild_settings.autopublish_channels` (JSON); dashboard Announcements tab.

## [1.8.6] - 2026-11-13

### Added
- Message bookmarks (1.8.6) — `/bookmark add <message_id or link> [note]` saves a message to your own list (only messages in channels you can read); `/bookmark list` shows yours (ephemeral, with jump links); `/bookmark remove <id>` removes one. A message context-menu command "Bookmark message" is also registered. Only a 500-character excerpt is stored — never the full message body. Bookmarks in `bookmarks`.

## [1.8.5] - 2026-11-13

### Added
- AFK voice channel auto-create (1.8.5) — `/afkchannel-setup` (admin) sets the primary AFK channel and the max users (default 10). When the primary AFK channel reaches max users, the bot creates a second AFK voice channel ("AFK 2") in the same category; when it empties, it's deleted. If the primary is empty for 10 minutes and a secondary exists and is also empty, the secondary is deleted. Settings in `guild_settings` (`afk_autocreate_enabled`, `afk_channel_id`, `afk_max_users`); dashboard Temp VC tab.

## [1.8.4] - 2026-11-13

### Added
- Invite rewards (1.8.4) — `/invitereward add <invites> <role|coins> <value>` (admin), `/invitereward list`, `/invitereward remove <invites>`. When a member's valid invite count reaches a configured milestone, the reward (role or coins to their economy wallet) grants automatically — once per milestone — and they're DM'd, plus a post in the invite log channel if set. Fake joins never count. `/myinviterewards` shows progress to the next reward. Milestones in `invite_rewards`, grants in `invite_reward_grants`; dashboard Invites tab lists them with add/remove.

## [1.8.3] - 2026-11-13

### Added
- Auto-role on level — announcement side (1.8.3) — level role rewards already auto-grant on level-up (1.3.5); this version adds the announcement channel. `/levelup-channel set <channel>` (admin) picks where the bot posts an embed when someone levels up AND gains a role; `/levelup-channel view` / `clear` manage it. `/levelrewards` already shows which roles auto-grant at which levels. Channel in `guild_settings.levelup_channel_id`; dashboard Leveling tab has the dropdown + reward roles list.

## [1.8.2] - 2026-11-13

### Added
- Ticket ratings (1.8.2) — when a ticket closes, the creator is DM'd a 1–5 star prompt (buttons) with an optional comment modal. If their DMs are closed the prompt is skipped silently and the skip is logged. `/ticket-ratings` (staff) shows the average rating, count, and recent ratings with comments; dashboard Staff → Tickets page has the average card + ratings table. Ratings in `ticket_ratings`.

## [1.8.1] - 2026-11-13

### Added
- Poll results chart (1.8.1) — when a poll ends, the results message includes a bar chart (node-canvas, already installed for the welcome cards) with each option's vote count and percentage. `/poll-results <message_id or link>` shows any poll's results with the chart, live or ended. Final tallies are stored in `polls.final_counts` so results survive restarts (add the column on existing installs: `ALTER TABLE polls ADD COLUMN final_counts JSON NULL;`). Dashboard Polls tab shows past polls with charts.

## [1.7.8] - 2026-11-13

### Added
- Embed builder (1.7.8) — `/embed create` (admin) — modal (title, description, color), then a second modal for image/footer/channel — posts the finished embed to the chosen channel. `/embed edit <message_id or link>` (admin) edits an existing bot-posted embed in place. Built embeds stored in the `embeds` table; dashboard Embeds tab lists them with edit (form) and delete.

## [1.7.7] - 2026-11-13

### Added
- Snipe (1.7.7) — `/snipe [channel]` and `/editsnipe [channel]` (staff only) show the last deleted message / last edited message's before-and-after as an embed. In-memory only — deleted message content is never written to the database or the error log — kept per channel for 10 minutes. If nothing recent, the bot says so.

## [1.7.6] - 2026-11-13

### Added
- Custom status roles (1.7.6) — `/statusrole add <text> <role>` (admin), `/statusrole remove <text>`, `/statusrole list`. On presence update, if a member's custom status contains the trigger text (case-insensitive) the role is granted; when it stops containing it, the role is removed. A 10-minute sweep catches missed updates. Guards: the role must sit below the bot's highest role; bots never get status roles. Honest note: custom statuses only update when Discord sends a presence update, so there can be a delay. Rules in `status_roles`; dashboard Roles tab lists them with add/remove.

## [1.7.5] - 2026-11-13

### Added
- Image-only starboard (1.7.5) — `/starboard-image-setup` (admin) sets a separate image channel + threshold (default 3). Same star-reaction flow as the main starboard, but only messages with image/video attachments qualify — they post as a large-image embed in the image channel. If no image channel is set, image posts go to the main starboard as before. Settings in `guild_settings` (`image_starboard_channel_id`, `image_starboard_threshold`); dashboard Starboard tab.

## [1.7.4] - 2026-11-13

### Added
- AFK voice kick (1.7.4) — `/afkvoice-setup` (admin) enables it, sets the minutes threshold (default 30) and the AFK channel (blank = disconnect instead). On voice state changes the bot tracks when a member goes mute/deafened; a 5-minute timer moves members muted/deafened continuously longer than the threshold to the AFK channel. Never moves bots, members already in the AFK channel, or holders of a configurable exempt role. Moves logged to `afk_voice_moves` + modlog if set. Dashboard Moderation tab has the settings.

## [1.7.3] - 2026-11-13

### Added
- Slowmode presets (1.7.3) — `/slowmode set <seconds> [channel]` (admin) applies immediately; `/slowmode-schedule <channel> <day_seconds> <night_seconds> <night_start> <night_end>` (admin) sets a day/night schedule — a 15-minute timer applies the right value for the current hour. `/slowmode-schedule-remove <channel>` (admin). Schedules in `slowmode_schedules`; dashboard Moderation tab lists and edits them.

## [1.7.2] - 2026-11-13

### Added
- Event scheduler (1.7.2) — `/event create <title> <date/time> [description] [channel]` (staff) posts an embed with Going / Maybe / Can't go buttons; `/event list`, `/event cancel <id>` (admin). A 1-minute timer sends RSVP'd members (Going/Maybe) a DM reminder 1 hour before — channel mention if their DMs are closed — and posts a "starting now" message in the channel. Events in `scheduled_events`, RSVPs in `event_rsvps`. Dashboard Events tab lists upcoming events with RSVP counts and can create/cancel them.

## [1.7.1] - 2026-11-13

### Added
- Wordle / daily games (1.7.1) — `/wordle` — one game per user per day, same word for everyone in the server (seeded from date + guild id, like daily trivia). Guess via modal (5 letters, 6 guesses), green/yellow/grey-square feedback, win/lose embed, streak tracked (consecutive winning days; a loss or missed day resets to 0). `/wordle-leaderboard` shows top streaks/wins. The word list is `src/data/words.json`: 1,200 common answers + 14,855 allowed guesses, from the open tabatkins/wordle-list and first20hours/google-10000-english lists — not hand-written. Games in `wordle_games`. Dashboard Games tab shows today's word (staff only) and the leaderboard.

## [1.6.6] - 2026-11-13

### Added
- Voice leaderboard (1.6.6) — `/voicelb` ranks members by total voice time, from `voice_sessions`; `/voicetime [user]` shows your (or their) total voice time. Voice time only counts when not muted/deafened and at least one other non-bot user is in the channel (the same rules as voice XP, 1.4.3).

## [1.6.5] - 2026-11-13

### Added
- Birthday role (1.6.5) — `/birthday-role` (admin) picks a role that is granted to a member on their birthday and removed the next day. The daily birthday checker handles both the grant and the removal; grants are tracked in `birthday_roles_granted` so a role is never double-granted or left behind.

## [1.6.4] - 2026-11-13

### Added
- Confessions (1.6.4) — `/confess <text>` posts an anonymous confession; the author is never shown publicly (posts show only "Anonymous" + a number). A staff approval queue is on by default: confessions wait in a review channel until staff approve or deny them, and denied confessions are never posted. Approval can be turned off per server. Authors are visible to staff only in the review queue (`confessions` table).

## [1.6.3] - 2026-11-13

### Added
- Daily streaks (1.6.3) — `/daily` now builds a streak: +25 XP per streak day, with the streak bonus capped at +500, tracked in the `streaks` table. Milestone crates are awarded at 7/30/100-day streaks. `/streak` shows your current streak and `/streak-leaderboard` ranks the longest streaks. Missing a day resets the streak to 0.

## [1.6.2] - 2026-11-13

### Added
- XP role shop (1.6.2) — per-server configurable: each guild has its own `xp_shop_items` catalog and prices, no global catalog. `/xpshop` lists your server's items, `/xpshop-add <role> <xp_price>` (admin) adds one, `/xpshop-remove <role>` (admin) removes one. Buying spends leveling XP (not coins) and grants the role.

## [1.6.1] - 2026-11-13

### Added
- Thread auto-archive control (1.6.1) — per-channel archive-duration overrides in `thread_archive_settings`: `/threadarchive set <channel> <duration>` (admin) sets 1h/24h/3d/1w or off. Threads in overridden channels are auto-archived after the chosen inactivity, skipping pinned threads and threads with recent staff activity. Dashboard Moderation tab lists the overrides.

## [1.5.5] - 2026-11-13

### Added
- Quote system (1.5.5) — `/quote <text> [author]` saves a quote, `/quotes [user]` lists saved quotes, `/quote-random` posts a random one, and `/quote-leaderboard` ranks who has the most saved quotes (`quotes` table). Quote embeds are public posts.

## [1.5.4] - 2026-11-13

### Added
- Server backup/restore (1.5.4) — `/serverbackup create` (admin) exports roles, channels, and bot settings to a JSON file in `backups/`; `/serverbackup restore <file>` (admin) restores them with a two-step confirm. Non-destructive by default: nothing existing is deleted unless explicitly confirmed. Message history is NOT backed up (stated in the README).

## [1.5.3] - 2026-11-13

### Added
- Anti-ghost-ping (1.5.3) — when a message that pinged someone is deleted, the bot posts a callout naming who was ghost-pinged and by whom (plus the modlog, if set). Bot and automod deletions are excluded, and at most 1 callout is posted per user per minute. `/ghostping-setup` (admin) sets the callout channel and toggle.

## [1.5.2] - 2026-11-13

### Added
- Temp roles (1.5.2) — `/temprole give <user> <role> <duration>` (mod) grants a role that expires automatically on a minute timer (`temp_roles` table); expiry is logged to the modlog. `/temprole list` shows active temp roles and `/temprole remove` ends one early.

## [1.5.1] - 2026-11-13

### Added
- Media auto-threads (1.5.1) — when a message with an image/video attachment is posted in a configured media channel, the bot creates a thread on it for discussion. `/mediathreads set <channel>` (admin) toggles a channel; `/mediathreads list` shows the configured channels.

## [1.4.6] - 2026-11-13

### Added
- Modmail (1.4.6) — members DM the bot to open a modmail thread in a staff channel; staff replies relay back to the member's DMs and member DMs relay into the thread (`modmail_threads` / `modmail_messages` tables). `/modmail-setup` (admin) picks the staff channel, `/modmail-close` (staff) closes a thread, `/modmail-block` (staff) blocks a user from modmail (`modmail_blocks`).

## [1.4.5] - 2026-11-13

### Added
- Clips with live announcements (1.4.5) — when a streamer goes live, the announcement can include their latest Twitch clip (Helix) or, for YouTube streamers, their latest video (YouTube has no clips API). `/stream-clip-toggle <streamer>` (admin) turns the clip on or off per streamer. If the clip fetch fails, the live announcement still goes out — a clip failure never blocks it.

## [1.4.4] - 2026-11-13

### Added
- Self-assignable color roles (1.4.4) — `/color list` shows the server's color roles, `/color set <role>` gives you one color role at a time (your old one is removed), `/color remove` clears it. `/color-add` and `/color-remove-role` (admin) manage the catalog (`color_roles` table). The bot checks role hierarchy before granting.

## [1.4.3] - 2026-11-13

### Added
- Voice XP (1.4.3) — members earn leveling XP for time in voice channels (default 2 XP/min), using the same `user_levels` table as message XP. Only counts when not muted/deafened and at least one other non-bot user is present. `/voicexp` (admin) shows the setting; voice sessions are recorded in `voice_sessions`.

## [1.4.2] - 2026-11-13

### Added
- Minecraft live status widget (1.4.2) — `/mcstatus-setup <server> [channel]` (admin) posts an embed showing a Minecraft server's live status (online players, version, MOTD) that refreshes every 5 minutes (`mc_widgets` table). Reuses the existing Minecraft ping provider.

## [1.4.1] - 2026-11-13

### Added
- AI chat/Q&A (1.4.1) — `/ask <question>` plus an AI channel, answered from the owner's own OpenAI-compatible API key in the `config.json` `ai` section (get a key at platform.openai.com/api-keys; see `_whereToGetKeys`). 10-second per-user rate limit, daily per-guild cap default 100, usage logged in `ai_usage`. If no key is configured, the feature replies with a clear disabled message instead of failing.

## [1.3.6] - 2026-11-13

### Added
- Custom welcome images (1.3.6) — new-member welcome posts can use a 900x300 canvas card with the member's avatar, name, and member count (`welcomeCard.js`, node-canvas). Falls back to a plain embed if canvas fails to load (missing native build deps — documented in the README). Toggle in the welcome settings / dashboard Welcome tab.

## [1.3.5] - 2026-11-13

### Added
- Level-up reward reminders (1.3.5) — `/levelrewards` lists the level roles and the level at which each is granted, plus any reminders you have set. A "Remind me" button on a reward you haven't reached stores a reminder (`level_reminders` table) and the bot DMs you when you hit that level. If the guild has no level rewards configured, the command says so.

## [1.3.4] - 2026-11-13

### Added
- Server analytics page (1.3.4) — dashboard Analytics page with joins/leaves over time, messages per day, top channels, and top users, drawn from real MySQL data (`guild_daily_stats`, `message_logs`, `user_stats`) with vanilla-JS charts. No made-up numbers.

## [1.3.3] - 2026-11-13

### Added
- XP boosts (1.3.3) — `/xpboost start <multiplier> <duration>` (admin) starts a server-wide XP boost, `/xpboost stop` ends it early, `/xpboost status` shows the active boost and time left (`xp_boosts` table). Boosts multiply message (and voice) XP while active.

## [1.3.2] - 2026-11-13

### Added
- Ticket transcripts in dashboard (1.3.2) — Staff → Transcripts lists every closed ticket's HTML transcript with search, view, and download (`ticket_transcripts` index table; the list backfills from transcript files on disk so older transcripts show up too).

## [1.3.1] - 2026-11-13

### Added
- Giveaway requirements (1.3.1) — `/giveaway start` now takes optional `required_role`, `min_days`, and `min_level`; members who don't meet them can't enter and get an ephemeral embed naming exactly what they missed (role, days in server, or leveling level). Requirements are stored on the giveaway and shown on the giveaway embed.

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
