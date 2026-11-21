# Ace's Discord Bot

A multi-file JavaScript Discord bot built with **discord.js v14** (CommonJS) — moderation, music, server status/monitoring, fun/games, tickets, streams, leveling, Steam, giveaways, reaction roles, game-server status, and a web dashboard, all in one command-handler project. Everything is stored in **MySQL** (with a JSON fallback for warns) and the bot works across **many servers, sharded**.

> **Embed standard:** EVERY slash-command reply is an embed. Use `src/utils/embeds.js` — `successEmbed(title, description)` (green), `errorEmbed(title, description)` (red), `infoEmbed(title, description, fields)` / `statsEmbed(...)` (brand color from `config.json` `embedColor`, timestamp + `Vikings Hall • /utility help` footer on every embed). Do not reply with plain text as the main response. Role-mention pings (stream-live, giveaway winners) may still appear as message content *alongside* an embed, since pings don't work reliably inside embeds.
>
> **Public replies (since 1.15.7):** EVERY slash-command reply, followUp, and deferReply is PUBLIC (visible to everyone in the channel) — the `ephemeral: true` flag is gone. The only exceptions are replies that would expose private data (birthdays, verification, modmail, reports, personal lists, owner output) or per-click confirmations that would spam the channel or spoil a game (giveaway/reaction-role/role-menu/RSVP/heist/suggestion-vote/wordle/trivia confirmations). /utility help and /fun trivia are public but their menus/buttons are invoker-only via a collector filter.

## Wiki

User-facing docs live on the dashboard at **`/docs`** (also linked from the header, footer, home page, and the `/version` page): getting started, a command reference for every slash command grouped by category (generated live from `src/commands`, so it can't go stale), step-by-step feature guides, and an FAQ. The static content (guides + FAQ) lives in `docs/content.json`; the command reference is built at request time by `src/utils/docs.js`. The page has a client-side search box (see "Dashboard JavaScript").

## Features

| Category | Commands |
| --- | --- |
| Moderation | `/mod kick`, `/mod ban`, `/mod timeout`, `/mod warn` (add/list, JSON-backed + DB mirror), `/mod clear`, `/mod unban`, `/utility setup` (per-server settings), `/mod tempban`, `/mod tempban-list`, `/mod tempban-cancel` (v1.9.1), `/mod purge` (v1.9.2 — by user / contains text) |
| Music | `/music play`, `/music skip`, `/music stop`, `/music queue`, `/music pause`, `/music resume`, `/music filter`, `/music lyrics`, `/music nowplaying`, `/music playlist` (save/load/list/delete/rename — saved queues, per-user per-server) — `@discordjs/voice` + `play-dl`, DJ-role enforcement, Spotify track links matched on YouTube |
| Status / monitoring | `/utility ping` (shard-aware, lists every shard), `/utility uptime`, `/utility serverinfo`, `/utility userinfo`, `/utility status`, `/utility botstats`, `/utility mystats`, `/utility shards`, `/utility topcommands`, `/utility topusers`, `/utility guildstats`, `/utility globalstats` (owner), `/utility hostinfo` (owner — host OS/CPU/memory/disk/runtime specs) |
| Fun & games | `/fun 8ball`, `/fun coinflip`, `/fun dice`, `/fun rps`, `/fun trivia` (built-in bank, no external API), `/fun trivia-daily`, `/fun trivia-leaderboard` — daily server-wide trivia, first correct answer wins 50 coins (v1.10.2); `/fun ship`, `/fun hug`, `/fun kiss`, `/fun slap` — social actions (v1.13.8) |
| Tickets | `/ticket setup`, `/ticket close`, `/ticket add`, `/ticket remove`, `/ticket claim` — panel + modals + HTML transcripts |
| Server Stats | `/utility serverstats-setup`, `/utility serverstats-toggle` — live stat voice channels |
| Streams | `/stream add`, `/stream remove`, `/stream list`, `/stream announce`, `/stream check` — Twitch/YouTube/Kick live alerts, TikTok/Facebook manual (v1.14.0) |
| Leveling | `/level rank`, `/level leaderboard`, `/level setlevel` — XP per message, role rewards |
| Steam | `/steam steam`, `/steam linksteam` |
| Giveaways | `/giveaway` (start/end/reroll/list) — button entry, random winners |
| Reaction Roles | `/reactionroles setup`, `/reactionroles add`, `/reactionroles remove`, `/reactionroles list`, `/reactionroles toggle` — button toggles, with optional requirements (required role, min days in server, min leveling level), pause/resume (v1.14.1) |
| Verification | `/verify setup`, `/verify toggle` — button or math-question captcha gate (v1.2.1); `/verify verify` — verify from anywhere (v1.13.3) |
| Counting & bumps | `/counting setup`, `/counting reset`, `/counting leaderboard` — counting game + 2-hour bump reminders (v1.2.2, leaderboard v1.13.6) |
| Temp voice | `/tempvc tempvc` (limit/lock/unlock/rename/kick/claim), `/tempvc setup` — personal voice channels (v1.2.3, setup command v1.13.14) |
| Birthdays | `/birthday birthday` (set/remove/list/today/next), `/birthday setup` — daily birthday announcements (v1.2.5, today/next v1.13.5) |
| Weather | `/weather weather`, `/weather forecast`, `/weather set`, `/weather home` — Open-Meteo, no API key (v1.2.7, home location v1.13.12) |
| Game Servers | `/gameserver serverstatus`, `/gameserver add`, `/gameserver remove`, `/gameserver list` — pluggable providers |
| Owner | `/owner restart`, `/owner reload`, `/owner shutdown`, `/owner eval` (owner-only, `ownerId` in config), `/utility hostinfo` (owner-only — host OS/CPU/memory/disk/runtime specs) |
| Announcements | `/tools announce` (admin — post an announcement in a channel: title, description, optional color hex, image URL, footer, role ping, plain-text mode) |
| Welcome | `/welcome setup`, `/welcome toggle`, `/welcome goodbye-setup`, `/welcome goodbye-toggle`, `/welcome test` — templated join/leave embeds (`{user}` `{username}` `{server}` `{membercount}`), `/welcome dm set\|toggle` — private welcome DM (v1.9.3) |
| Automod | `/automod automod`, `/automod setup`, `/automod words add\|remove\|list`, `/automod exempt add-role\|remove-role\|add-channel\|remove-channel\|list`, `/automod antispam`, `/automod content-filter` — spam, banned words, link/invite blocking, duplicate/caps/mention/link-spam detectors, per-rule content filter (v1.14.4, v1.14.5) |
| Suggestions | `/suggest suggest` (modal), `/suggest suggestions-setup`, `/suggest status` — 👍/👎 voting, staff Approve/Deny/Implement |
| Economy | `/economy balance`, `/economy daily`, `/economy work`, `/economy pay`, `/economy eco-leaderboard`, `/economy shop`, `/economy shop-add`, `/economy deposit`, `/economy withdraw`, `/economy quest`, `/economy roleshop` — wallet + bank, shop roles, `/economy lottery buy\|status\|winners` — weekly draw (v1.9.4, quests v1.13.9, role shop v1.13.10) |
| Casino | `/casino slots`, `/casino blackjack`, `/casino roulette`, `/casino gamble-coinflip`, `/casino gamble-dice`, `/casino heist` — group heist, 40% + 10%/extra crew member (cap 90%), bet back x2 on success (v1.10.3) — same wallet balance, min bet 10 / max 10,000 |
| Milestones | `/utility milestones`, `/utility milestone-setup` — round member-count celebrations + 100-coin trigger bonus (v1.10.4) |
| Role Menus | `/role rolemenu` (create/add/remove/list/delete) — select-menu role pickers with the same requirements as reaction roles (v1.10.5) |
| Translate | `/tools translate`, `/tools translate-setup`, "Translate message" context menu — on-demand + auto-translation via Google's free unofficial endpoint (v1.10.6, context menu v1.13.13) |
| Inventory & Trading | `/economy buy`, `/economy sell`, `/economy inventory`, `/economy open-crate`, `/economy use`, `/economy trade`, `/economy trade-cancel` — crates, daily items, daily deals, atomic player trades |
| Bot Tracking | `/staff botflags`, `/staff botflag`, `/staff botflag-clear`, `/staff bottrack` (staff) — join scoring, raid watch, Staff → Bot Tracking page |
| Starboard | `/starboard setup` — starred messages posted to a starboard channel |
| Custom Commands | `/custom add`, `/custom remove`, `/custom list` — trigger words with stored replies |
| Message Logging | `/mod modlog-setup` — deleted/edited messages logged to a modlog channel |
| Member Logging | `/mod logging setup\|status` — joins, leaves, bans, kicks, timeouts, role changes (v1.14.2) |
| Safety | `/mod safety-status` — one-command protection overview (v1.14.6) |
| Autoresponder | `/tools autoresponder add\|remove\|toggle\|list` — automatic phrase replies (v1.14.3) |
| Moderation | `/mod report` (submit/list) — user reports to the modlog (v1.13.2); `/mod lockdown` (lock/release/status) — lock a channel to mods (v1.13.4) |
| Emojis | `/emoji add`, `/emoji remove`, `/emoji list` (v1.11.2); `/emoji steal-emoji` — copy an emoji from another server (v1.13.15) |
| Confessions | `/fun confess` (modal, anonymous, approval queue) (v1.6.4); `/fun confess-setup` — configure channel + approval (v1.13.7) |
| AFK | `/tools afk`, `/tools afk-remove`, `/tools afk-list` — mentions answered, auto-clear on return (list v1.13.1) |
| Polls | `/tools poll`, `/tools poll-end` — reaction voting, one vote per user, live tally |
| Auto-role | `/tools autorole set\|remove\|view\|sticky` — join role + sticky roles |
| Scheduled | `/tools schedule`, `/tools schedule-list`, `/tools schedule-cancel`, `/tools remindme`, `/tools remind` (set/list/cancel) — DB-backed, survives restarts (v1.13.0) |
| FAQ | `/faq add`, `/faq remove`, `/faq list` — auto-responder for common questions |
| Presence | `/owner presence set\|reset\|list` (owner) — rotating Discord status with live stats |
| Server rules & Anti-nuke | `/tools rules-setup`, `/tools rules`, `/tools rules-edit` — one rules embed per server (v1.9.5); `/staff antinuke-setup`, `/staff antinuke-status` (staff) — destructive-action burst protection (v1.9.6) |
| Help | `/utility help` — grouped command list with a category select menu |

## Project structure

```
discord-bot/
├── config.json / config.example.json   # THE config (gitignored) — see below
├── index.js                            # Client setup + handlers (unsharded entry)
├── package.json
├── README.md
├── transcripts/                        # Generated ticket transcripts (HTML)
├── dashboard/
│   ├── views/  (EJS: home, settings, added, staff, setup, partials/header+footer)
│   └── public/style.css + favicon.svg
├── deploy/nginx/ace-bot.conf + README.md  # Nginx reverse-proxy template
├── scripts/backup-db.js, restore-db.js # Daily MySQL backup + restore
├── logs/bot-errors.log                 # Error log file (gitignored)
├── sql/schema.sql                      # All MySQL tables
└── src/
    ├── shardManager.js                 # Production entry (ShardingManager)
    ├── deploy-commands.js              # Global registration (guild only for dev)
    ├── dashboard.js                    # Express + Discord OAuth2 dashboard
    ├── handlers/  commandHandler.js, eventHandler.js
    ├── commands/  moderation/ music/ utility/ fun/ tickets/ streams/
    │              leveling/ steam/ giveaways/ reactionroles/ gameservers/ owner/
    │              applications/ invites/ staff/
    ├── events/    ready, interactionCreate, ticketInteraction, giveawayInteraction,
    │              reactionRoleInteraction, applicationInteraction, inviteEvents,
    │              guildMemberAdd, guildMemberRemove, presenceUpdate, messageCreate (XP)
    ├── utils/     config.js, database.js, embeds.js, warns.js, musicQueue.js,
    │              guildSettings.js, tickets.js, transcript.js, serverStats.js,
    │              streamNotifier.js, leveling.js, steam.js, giveaways.js,
    │              reactionRoles.js, gameServers.js, djCheck.js, ownerCheck.js,
    │              staff.js, featureToggles.js, applications.js, inviteTracker.js,
    │              errorLogger.js, liveChannelTemplate.js
    └── data/      warns.json, trivia.json
```

## Setup

### First-run setup wizard (recommended — no manual config.json editing)

1. **Install dependencies:** `npm install`
2. **Start the dashboard:** `npm run dashboard`
3. **Open the wizard:** on first run the dashboard prints a one-time setup link to the console and writes the token to `setup-token.txt` — open `http://localhost:3010/setup?token=<token>` (or `https://your-domain/setup?token=<token>` behind a reverse proxy). The token is single-use: presenting it starts your setup session and invalidates it.
4. **Follow the 8 steps:** Welcome → Discord (token/client ID/secret/owner ID, with a **Test connection** button — an invalid token can't be saved) → Database (MySQL connection test + optional auto-run of `sql/schema.sql`) → Dashboard (port, session secret with a generate button, redirect URI auto-filled) → Streaming APIs (optional) → Steam API (optional) → Backups & misc (backup time, 30-day retention, embed color, queue size, sharding) → Review & finish (secrets masked) → **Save** writes `config.json` (mode 0600, preserving fields the wizard didn't ask about) and sets `setupComplete: true`, disabling the wizard. Then run `npm run deploy`, `npm start`, `npm run dashboard` as shown on the finish screen.
5. **Re-running setup:** after first setup the wizard only opens for the bot owner (logged-in owner session). To re-run from scratch, set `setupComplete: false` in `config.json` and restart the dashboard for a fresh one-time token.

**Running on an Ubuntu server (not your PC)?** See the full deployment guide — [`docs/deployment/ubuntu-nginx.md`](docs/deployment/ubuntu-nginx.md) — Node.js + MySQL install, cloning, the wizard through your domain, `npm run deploy` / `npm start`, systemd services so the bot and dashboard survive reboots, Nginx, and free HTTPS via Certbot.

**Security:** the wizard is protected by the one-time token (rate-limited to 10 attempts per 15 min per IP), never echoes secrets back in full, never logs them, and shows a warning banner when reached over plain HTTP — serve it over HTTPS in production (see Nginx deployment below). `setup-token.txt` is gitignored and never uploaded to Drive.

### Manual setup (alternative)

1. **Install dependencies:** `npm install`
2. **Create your config:** `cp config.example.json config.json`, then fill in your own values (placeholders only in the example). `config.json` is gitignored — **never share your token or commit it.**
   ```json
   {
     "token": "PASTE_YOUR_BOT_TOKEN_HERE",
     "clientId": "YOUR_APPLICATION_ID",
     "guildId": "",
     "welcomeChannelId": "",
     "ownerId": "YOUR_DISCORD_USER_ID",
     "embedColor": "#5865F2",
     "music": { "maxQueueSize": 25 },
     "database": { "host": "localhost", "port": 3306, "user": "discord_bot", "password": "YOUR_MYSQL_PASSWORD_HERE", "database": "discord_bot" },
     "sharding": { "mode": "auto", "totalShards": null },
     "serverStats": { "updateIntervalMinutes": 10 },
     "leveling": { "xpPerMessageMin": 15, "xpPerMessageMax": 25, "cooldownSeconds": 60, "levelUpMessages": true },
     "steam": { "apiKey": "YOUR_STEAM_API_KEY_HERE" },
     "streams": { "checkIntervalMinutes": 5, "twitch": { "clientId": "", "clientSecret": "" }, "youtube": { "apiKey": "" }, "announceOfflineMessage": false },
     "gameServers": { "checkIntervalMinutes": 5, "custom": [] },
     "dashboard": { "clientSecret": "", "redirectUri": "http://localhost:3010/callback", "sessionSecret": "CHANGE_ME_TO_A_LONG_RANDOM_STRING", "port": 3010, "invitePermissions": 1099951041558 }
   }
   ```
3. **MySQL:** create the database, then `mysql -u <user> -p discord_bot < sql/schema.sql`. Fill in the `database` section. **Fallback:** if MySQL is unconfigured or unreachable, the bot logs a warning at startup and keeps running — commands still work, logging/stats/tickets/streams/giveaways/leveling are skipped.
4. **Register commands:** `npm run deploy` (global by default; set `guildId` only for fast dev testing — guild commands appear instantly, global can take ~1 hour).
5. **Start:** `npm start` (sharded, production) or `npm run start:unsharded`. Dev: `npm run dev`. Dashboard separately: `npm run dashboard`.

## Discord Developer Portal — intents

Create an application, add a Bot, copy its **token** → `config.json` `token` and its **Application ID** → `clientId`. Invite with `bot` + `applications.commands` scopes (or use the dashboard's **Add to Server** button). Enable these **Privileged Gateway Intents**:
- **Server Members Intent** — welcome messages, member lookups, leveling role grants.
- **Message Content Intent** — XP awarding reads message content (`messageCreate`).
- **Guild Presences Intent** — the "Online" server-stat channel count.

`GuildVoiceStates` (non-privileged) is also enabled — required for music.

## Multi-server + sharding

- Commands register **globally** by default, so the bot works in every server it joins. `guildId` in config is only for fast dev testing.
- Per-server settings (welcome/log channels, ticket category/role/log, warn threshold/action, DJ role, embed color, server-stats channels, level roles) live in MySQL `guild_settings`, edited with `/utility setup` or the dashboard. The bot caches them for 60s, so dashboard changes are picked up without a restart.
- **Sharding:** `npm start` runs `src/shardManager.js` (ShardingManager spawning `index.js` workers). `sharding.mode: "auto"` (default) lets Discord recommend the count — roughly **1 shard per 1,000 guilds** — so it scales with usage and you don't need to hand-tune it. Set `mode: "manual"` + `totalShards: N` only with a specific reason. `npm run start:unsharded` runs one process (fine for 1 server).
- Per-shard state is independent: music queues live in memory per shard, warns/stats/logs live in MySQL so cross-shard stats come from the DB. `/utility shards` is the detailed shard overview; `/utility ping` lists every shard's ping + guild count, with ▶ marking the shard that answered.

## MySQL — what is logged

Every slash command is logged to `command_logs` (success/failure) from `interactionCreate`, and guild/user counters update in `guild_stats` / `user_stats`. Music plays increment `songs_played`; joins increment `members_joined`. Warns are stored in the **JSON file first** (`src/data/warns.json`, the primary store so warns work with no DB) and mirrored to the `warns` table when MySQL is available. See `sql/schema.sql` for `command_logs`, `guild_stats`, `user_stats`, `warns`, `guild_settings`, `streamers`, `tickets`, `user_levels`, `user_links`, `giveaways`, `giveaway_entries`, `reaction_roles`, `game_servers`, `game_server_status`.

## Music

Join voice, then `/music play <song name or YouTube URL>`. Uses `play-dl` (no API key). Queue capped by `music.maxQueueSize` (default 25). If DJ mode is on (`/music dj-setup` or dashboard → Music), only the DJ role + admins can use the music control commands (`/music skip`, `/music stop`, `/music pause`, `/music resume`, `/music filter`, `/music queue-clear`); everyone else gets an ephemeral error naming the DJ role. `/music play`, `/music lyrics`, `/music queue` and `/music nowplaying` stay open to everyone while "gate only control commands" is on (the default) — turn it off and every music command needs the DJ role. DJ mode can't be enabled without a DJ role set. YouTube availability can vary — failed tracks are skipped with an embed. The queue manager is `src/utils/musicQueue.js` (the one place to swap the stream source, e.g. to yt-dlp).

**Music extras (v1.2.4):**
- **Spotify links:** `/music play` accepts an `open.spotify.com` track link. The track is resolved to title + artist via Spotify's public oEmbed endpoint (no key) and matched on YouTube. **Spotify audio itself is never streamed** — there is no public Spotify audio API, so this is a lookup, not a Spotify stream. Playlist/album links only resolve to their top YouTube result, since a playlist can't be expanded without a Spotify API key.
- **Filters:** `/music filter bassboost|nightcore|vaporwave|8d|off` re-encodes the current track through FFmpeg (prism-media) with the filter — so the track restarts from the beginning with the filter on. Filters can't be applied mid-stream to an already-playing Opus resource without re-encoding.
- **Lyrics:** `/music lyrics [song]` fetches lyrics from the free lyrics.ovh API (no key). For the song playing now it splits the YouTube title as `Artist - Title`; name a song the same way (`/music lyrics song: Queen - Bohemian Rhapsody`). "No lyrics found" is reported gracefully.
- **Now playing:** `/music nowplaying` shows a rich embed with the title, a progress bar (elapsed/total), the requester, how many tracks are waiting, and the active filter.

## Verification gate (v1.2.1)

New members verify before getting the member role. `/verify setup <channel> <role> [mode]` posts a Verify button panel in the channel and enables the gate; `/verify toggle` turns it on/off. **Button mode:** click Verify and the role is granted. **Captcha mode:** click Verify, then answer a quick math question in a modal — an image-free captcha (no image generation; the question is a simple arithmetic problem, so it stops casual bots, not determined humans). New members are DM'd where to verify. Grants and failures are logged to `verification_logs`. Dashboard Verification tab has the same settings (channel, role, mode, toggle).

## Counting & bump reminders (v1.2.2)

- **Counting:** `/counting setup <channel>` starts the game. Each message in the channel must start with the next number (`5` or `5 hello` both count). A wrong number, a message with no leading number, or the same person counting twice in a row deletes the message and resets the count to 0, with an embed naming who ruined it and how high the run got. Correct counts get a ✅ reaction. `/counting reset` resets manually. State lives in `counting_settings` (`current_count`, `highest_count`, `last_counter_id`). Dashboard Counting tab shows the current/highest counts.
- **Bump reminders:** when someone types `!d bump`, or DISBOARD confirms a bump, the time is recorded (`bump_settings`). Two hours later the bot posts a "Time to bump!" reminder in the bump channel (`/counting bump-setup` sets it; reminders only fire once per bump). `/counting bump` shows the time until the next bump, and `/counting bump record` records a manual bump (use it if DISBOARD's confirmation isn't picked up).

## Temporary voice channels (v1.2.3)

Set the "create" voice channel and a category on the dashboard Temp VC tab (or in `guild_settings`: `tempvc_create_channel_id`, `tempvc_category_id`). Joining the create channel spins up a personal voice channel named after the member (e.g. "Ace's Channel") and moves them in; it is deleted when it becomes empty. Owners manage theirs with `/tempvc tempvc limit <n>`, `/tempvc tempvc lock` / `/tempvc tempvc unlock`, `/tempvc tempvc rename <name>`, `/tempvc tempvc kick @user`, and `/tempvc tempvc claim` (claim a channel whose owner left — only works once the owner is out of the channel). Ownership is tracked in `temp_channels`.

## Birthdays (v1.2.5)

Members set their birthday with `/birthday birthday set <month> <day> [year]` — real dates only (Feb 29 is allowed; leap birthdays are celebrated on Feb 28 in non-leap years). `/birthday birthday remove` removes it; `/birthday birthday list` shows the next 10 upcoming birthdays with ages when a year was given. `/birthday setup <channel> [hour]` sets the announcement channel and hour (default 9 AM, **bot host local time** — documented here because the bot has no per-guild timezone). A checker runs hourly and posts a birthday embed once per user per year (`birthdays.announced_last_year`). Dashboard Birthdays tab has the channel/hour settings and the saved-birthday list.

## Weather (v1.2.7)

`/weather weather <location>` shows current weather — temperature, feels-like, condition, humidity, wind speed/direction, pressure, visibility, sunrise/sunset — in an embed with a condition emoji. `/weather forecast <location> [days 1-7]` (default 3) shows one field per day: high/low, condition, precipitation chance. Locations accept a city name, ZIP code, or `"latitude,longitude"`. **Source: Open-Meteo (https://open-meteo.com) — free, no API key required** (geocoding + forecast APIs). `/weather set` (admin) stores a per-server default location and default units in `guild_settings` (`default_weather_location`, `weather_units`), so `/weather weather` with no location uses it. `/weather home set <location>` (v1.13.12) saves a personal home location per user, which `/weather weather` prefers over the server default. Units are imperial (°F, mph) by default and metric (°C, km/h) with the `units` option or the server default. Unknown places get a clear "couldn't find that place" embed; if Open-Meteo is down, the error is logged and the user gets an error embed instead of a crash.

## Giveaway requirements, transcripts, XP boosts, analytics, level rewards, welcome images, AI chat, Minecraft widget, voice XP, color roles, clips, modmail, media threads, temp roles, ghost-ping, backups, quotes, thread archive, XP shop, streaks, confessions, birthday role, voice leaderboard (v1.3.x–v1.6.x)

- **Giveaway requirements (v1.3.1):** `/giveaway start` takes optional `required_role`, `min_days`, and `min_level`. Members who don't meet them can't enter and get an ephemeral embed naming exactly what they missed.
- **Ticket transcripts (v1.3.2):** Staff → Transcripts in the dashboard lists every closed ticket's HTML transcript with search, view, and download (`ticket_transcripts` index table; the list backfills from files on disk).
- **XP boosts (v1.3.3):** `/level xpboost start <multiplier> <duration>` (admin) starts a server-wide XP boost; `/level xpboost stop` ends it; `/level xpboost status` shows the active boost and time left (`xp_boosts` table).
- **Server analytics (v1.3.4):** dashboard Analytics page — joins/leaves over time, messages per day, top channels, top users — from real MySQL data (`guild_daily_stats`, `message_logs`, `user_stats`), vanilla-JS charts.
- **Level-up reward reminders (v1.3.5):** `/level levelrewards` lists level roles and your reminders. A "Remind me" button on an unreached reward stores a reminder (`level_reminders`) and the bot DMs you when you hit that level.
- **Custom welcome images (v1.3.6):** welcome posts can use a 900×300 canvas card (avatar, name, member count). Falls back to a plain embed if canvas fails to load — node-canvas needs native build tools on the host (`build-essential`, `python3`, `libcairo2-dev`, `libpango1.0-dev`, `libjpeg-dev`, `libgif-dev`, `librsvg2-dev` on Ubuntu).
- **AI chat/Q&A (v1.4.1):** `/ai ask <question>` plus an AI channel, answered from the owner's own OpenAI-compatible API key in `config.json` (`ai.apiKey`, `ai.model` default `gpt-4o-mini`, `ai.baseUrl`, `ai.dailyLimit` default 100; get a key at platform.openai.com/api-keys). 10-second per-user rate limit, daily per-guild cap, usage in `ai_usage`. No key configured = a clear disabled message, not a crash.
- **Minecraft live status widget (v1.4.2):** `/gameserver mcstatus-setup <server> [channel]` (admin) posts an embed with a Minecraft server's live status (players, version, MOTD), refreshed every 5 minutes (`mc_widgets` table). Reuses the existing Minecraft ping provider.
- **Voice XP (v1.4.3):** members earn leveling XP for voice time (default 2 XP/min, same `user_levels` table). Only counts when not muted/deafened and at least one other non-bot user is present. `/level voicexp` (admin) shows the setting; sessions in `voice_sessions`.
- **Self-assignable color roles (v1.4.4):** `/role color list`, `/role color set <role>` (one at a time — your old one is removed), `/role color remove`. `/role color custom <hex>` (v1.13.11) creates a personal color role in any `#RRGGBB` color. `/role color-add` and `/role color-remove-role` (admin) manage the catalog (`color_roles` table). Role hierarchy is checked before granting.
- **Clips with live announcements (v1.4.5):** live announcements can include the streamer's latest Twitch clip (Helix) or latest YouTube video (YouTube has no clips API). `/stream clip-toggle <streamer>` (admin) per streamer. A clip fetch failure never blocks the live announcement.
- **Modmail (v1.4.6):** members DM the bot to open a thread in a staff channel; replies relay both ways (`modmail_threads` / `modmail_messages`). `/modmail setup` (admin), `/modmail close` (staff), `/modmail block` (staff, `modmail_blocks`).
- **Media auto-threads (v1.5.1):** messages with image/video attachments in a configured media channel get a thread for discussion. `/mediathreads add <channel>` (admin), `/mediathreads list`.
- **Temp roles (v1.5.2):** `/role temprole give <user> <role> <duration>` (mod) grants a role that expires on a minute timer (`temp_roles` table, expiry logged to the modlog). `/role temprole list`, `/role temprole remove` (early).
- **Anti-ghost-ping (v1.5.3):** when a message that pinged someone is deleted, the bot posts a callout naming who was ghost-pinged and by whom. Bot/automod deletions excluded; max 1 callout per user per minute. `/mod ghostping-setup` (admin).
- **Server backup/restore (v1.5.4):** `/serverbackup create` (admin) exports roles, channels, and bot settings to a JSON file in `backups/`; `/serverbackup restore <file>` (admin) restores with a two-step confirm. Non-destructive by default. **Message history is NOT backed up.**
- **Quote system (v1.5.5):** `/fun quote <text> [author]`, `/fun quotes [user]`, `/fun quote-random`, `/fun quote-leaderboard` (`quotes` table). Quote embeds are public posts.
- **Thread auto-archive control (v1.6.1):** `/mod threadarchive set <channel> <duration>` (admin) — per-channel overrides (1h/24h/3d/1w/off) in `thread_archive_settings`. Skips pinned threads and threads with recent staff activity.
- **XP role shop (v1.6.2):** per-server configurable — each guild has its own `xp_shop_items` catalog and prices. `/level xpshop`, `/level xpshop-add <role> <xp_price>` (admin), `/level xpshop-remove <role>` (admin). Buying spends leveling XP and grants the role.
- **Daily streaks (v1.6.3):** `/economy daily` builds a streak — +25 XP per streak day, bonus capped at +500, milestone crates at 7/30/100 days (`streaks` table). `/economy streak`, `/economy streak-leaderboard`. Missing a day resets the streak.
- **Confessions (v1.6.4):** `/fun confess` (modal) posts anonymously (author never shown publicly). `/fun confess-setup` (v1.13.7, admin) configures the channel and approval queue in Discord instead of only on the dashboard. Staff approval queue is on by default; denied confessions are never posted. Authors are visible to staff only in the review queue (`confessions` table).
- **Birthday role (v1.6.5):** `/birthday role` (admin) picks a role granted on a member's birthday and removed the next day (`birthday_roles_granted` tracks grants).
- **Voice leaderboard (v1.6.6):** `/level voicelb` ranks members by total voice time (`voice_sessions`); `/level voicetime [user]` shows total voice time.

## Saved playlists, daily trivia, heists, milestones, role menus, auto-translate (v1.10.x)

- **Saved playlists (v1.10.1):** `/music playlist save <name>` saves the current queue (playing track + queued tracks) as a named playlist; `/music playlist load <name>` queues it back (join voice first); `/music playlist list [user]`, `/music playlist delete`, `/music playlist rename`. Per-user, per-server — max 10 playlists per user per server, max 50 tracks each. Dashboard Music tab lists playlists with delete.
- **Daily trivia (v1.10.2):** one server-wide question per day, posted automatically at a configured hour (default 12:00 UTC) in a configured channel. The question is the same for the whole server (seeded by date + guild id) and reuses the existing `src/data/trivia.json` bank. First correct answer wins **50 coins** + a trivia point (`trivia_daily`, `trivia_scores`). `/fun trivia-daily play` answers today's question, `/fun trivia-daily setup` (admin) sets channel + hour, `/fun trivia-leaderboard` shows the top players. Dashboard Games tab has the settings and leaderboard.
- **Heist (v1.10.3):** `/casino heist <bet>` opens a 60-second lobby (public message, Join button). Success chance is 40% + 10% per extra crew member (cap 90%). Success pays everyone their bet back x2; failure loses the bet. Bets use the wallet balance, min 50 / max 5000 coins (`config.json economy.heistMinBet` / `heistMaxBet`), 1-hour cooldown per user, all flows in `economy_transactions`.
- **Member milestones (v1.10.4):** round member counts (100, 250, 500, 1000, 2000, 5000, 10000 — `config.json milestones`) get a celebration embed in a configured channel, and the member who triggers one earns a **100-coin** bonus. Each milestone fires once per guild (`milestones_hit`). `/utility milestones` shows the next milestone with a progress bar; `/utility milestone-setup` (admin) sets the channel. Dashboard General tab shows the settings and the next milestone.
- **Button role menus (v1.10.5):** `/role rolemenu create|add|remove|list|delete` (admin, max 25 options per menu — Discord's select limit). Members pick a role from a dropdown; selecting again removes it. The reaction-role requirements (required role / min days in server / min leveling level) apply, with an ephemeral embed naming the missed requirement. Dashboard Roles tab lists menus.
- **Auto-translate (v1.10.6):** messages in watched channels are auto-translated into the server's target language (default English). Translation uses Google's free unofficial endpoint (`translate.googleapis.com/translate_a/single`, `client=gtx`) — **no API key, but unofficial, no SLA, and it may rate-limit**; failures are skipped and logged, never fatal. Detection is a built-in heuristic (script + common-word matching), no extra dependency. `/tools translate <text> [to]` translates on demand; `/tools translate-setup` (admin) sets channels + target language. Dashboard General tab has the settings. Bot messages and commands are never translated.

## DJ mode, emoji manager, countdowns, prestige levels, ticket panels, invite roles (v1.11.x)

- **DJ mode (v1.11.1):** `/music dj-setup <role> [enabled] [only_skip]` (admin) turns DJ mode on for a server and picks the DJ role; `/music dj` (admin) shows the current settings. When DJ mode is on, only the DJ role + admins can use the control commands — `/music skip`, `/music stop`, `/music pause`, `/music resume`, `/music filter`, `/music queue-clear` — and everyone else gets an ephemeral error naming the DJ role. With `only_skip` on (the default), `/music play`, `/music lyrics`, `/music queue` and `/music nowplaying` stay open to everyone; with it off, every music command needs the DJ role. DJ mode can't be enabled without a DJ role set — the command and the dashboard both refuse with a clear error. Settings live in `guild_settings` (`dj_role_id`, `dj_enabled`, `dj_only_skip`); the dashboard Music tab has the role dropdown, the toggle, and a read-only list of which commands are DJ-only.
- **Emoji manager (v1.11.2):** `/emoji add <name> <image_url or attachment>` (admin with Manage Emojis) uploads a custom emoji — validated: PNG/JPG/GIF under 256KB, name 2–32 letters/numbers/underscores, and the server's emoji slot limit is checked first (a clear error if full). `/emoji remove <name>` (admin) and `/emoji list` (ephemeral, paginated) round it out. The dashboard Emojis tab lists the server's emoji with add (URL field) + remove. Additions and removals are logged to the database (`emoji_logs`: `guild_id`, `user_id`, `action`, `emoji_name`, `created_at`).
- **Countdowns (v1.11.3):** `/utility countdown create <title> <when> [channel]` (admin/staff) posts a countdown embed that updates itself — **every minute once under 24h is left, every 5 minutes before that** (to stay well inside Discord's rate limits). When it hits zero the message is edited to "🎉 \<title\> is here!" and the channel is pinged once. Times accept `in 2h30m`, `in 3d`, or an absolute date like `2026-12-25 18:00` (bot host local time). `/utility countdown list` shows active countdowns; `/utility countdown cancel <id>` (admin) cancels one and deletes its message. Stored in the `countdowns` table. Dashboard Events tab (Scheduled) has the list + create/cancel.
- **Prestige levels (v1.11.4):** extends leveling. At the max level (`config.json leveling.maxLevel`, default 100) a member can run `/level prestige` — a confirm-button flow, since it resets level to 1 and XP to 0 — and gains +1 prestige. Each prestige grants a permanent **+10% XP multiplier**, capped at **+100% (prestige 10)**: `multiplier = 1 + min(prestige, 10) × 0.1`. The prestige count is stored in `user_levels.prestige`, a ⭐ prestige badge shows on `/level rank` and the rank card, and a configured prestige role (`guild_settings.prestige_role_id`) is granted permanently. `/level prestige-leaderboard` shows the top prestige users. Dashboard Leveling tab has the max level note, the prestige role setting, and the prestige leaderboard.
- **Multi-ticket panels (v1.11.5):** the ticket system now supports multiple panels per guild, each with its own category, staff role, and topic. `/ticket panel create <title> <category> [staff_role] [channel] [description]` (admin) posts a new panel; `/ticket panel list` (admin) shows every panel with its category; `/ticket panel delete <id>` (admin) removes one. The existing `/ticket setup` stays as the default/first panel. Tickets opened from any panel record which panel they came from (`tickets.panel_id`, nullable — the column is added by a migration; the bot falls back to the default panel if the column doesn't exist yet). Dashboard Tickets tab lists panels with create/delete.
- **Invite-based auto-roles (v1.11.6):** extends the invite tracker. `/invite inviterole add <invite_code> <role>` (admin) maps an invite code to a role; when a member joins through that invite, the role is granted automatically. The role is based on the **code used**, not the inviter. Guards: the code must be a real active invite in the guild (validated on add) and the role must sit below the bot's highest role. `/invite inviterole list` and `/invite inviterole remove <invite_code>` manage the rules (`invite_role_rules` table). Dashboard Invites tab has the code → role rules list with add/remove.

## 24/7 music, booster role, work jobs, giveaway bonus entries, new-member link block, robbery (v1.12.x)

- **24/7 music mode (v1.12.1):** `/music 247 enable <voice channel>` (admin) keeps the bot in that voice channel around the clock — it stays connected even with an empty queue and rejoins if disconnected or kicked. `/music 247 disable` turns it off and the bot leaves; `/music 247 status` shows whether it is on and if the bot is connected right now. A checker runs every minute to rejoin a dropped connection. Settings live in `guild_settings` (`music247_enabled`, `music247_channel_id`); the dashboard Music tab has the toggle + channel dropdown. Rejoins are logged via the error logger (info level).
- **Nitro booster role (v1.12.2):** `/role boosterrole set <role>` (admin) picks the role Nitro boosters get automatically — granted when a member starts boosting, removed when they stop. Setting it also runs a one-time sweep granting it to current boosters. `/role boosterrole view` and `/role boosterrole remove` manage it. Guard: the role must sit below the bot's highest role. Stored in `guild_settings.booster_role_id`; dashboard Roles tab has the dropdown.
- **Work job upgrades (v1.12.3):** per-server job catalog (`work_jobs` table, `user_jobs` for the chosen job). Defaults seed on first use: Dishwasher (30–80 coins, free, level 0), Barista (50–120, 200 coins, level 2), Mechanic (80–200, 500 coins, level 5), Developer (150–400, 1,500 coins, level 10). `/economy jobs` lists this server's jobs; `/economy job buy <name>` unlocks one with wallet coins (level requirement checked); `/economy job set <name>` picks an unlocked job (free jobs can be picked directly). `/economy work` then pays from your job's payout range with that job's flavor text — no job, and it pays the old 50–250 range with a random flavor line. Dashboard Economy tab lists the server's jobs.
- **Giveaway bonus entries (v1.12.4):** `/giveaway start` takes optional `bonus_role` + `bonus_entries` (default 1, max 10). Holders of that role get +N entries, and Nitro boosters get +1 automatically when the guild has a booster role configured. The winner draw is **weighted** by total entries (`pickWeightedWinners` in `src/utils/giveaways.js`) — a member with 4 entries is 4x as likely to win as a member with 1 — and a winner's tickets are removed after winning, so nobody wins twice in one draw. The entry confirmation shows `Entries: N (includes X bonus)` with the reasons. Bonus entries are stored in `giveaway_bonus` (one row per entrant per giveaway); the giveaway embed and `/giveaway list` show the bonus rules, and the dashboard Giveaways tab has a Bonus entries column.
- **New-member link block (v1.12.5):** members who joined less than N days ago (default 7, `/automod newmemberlinks-setup` admin, or the dashboard Automod tab) cannot post links — the message is deleted, they get a warning that deletes itself after 10 seconds, and the block is logged to Automod actions. Runs independently of the main Automod toggle. Staff roles and Automod-exempt roles/channels bypass it; admins are always exempt. Settings live in `guild_settings` (`new_member_link_enabled`, `new_member_link_days`).
- **Economy robbery (v1.12.6):** `/economy rob @user` tries to steal from another member's **wallet** — the bank can never be robbed, so `/economy deposit` is the safe place for coins. Flat **35%** success chance. Success steals **10–30% of the victim's wallet** (min 10, max 1,000 coins). Failure: the robber pays a **fine of up to 100 coins to the victim**, capped at whatever the robber can actually afford (never below 0, never a debt — if the robber is broke, the fine is 0). Cooldowns: **30 minutes** after a success, **1 hour** after a failure (tracked in `rob_attempts`). Guards: no robbing bots or yourself, and the victim needs at least 50 coins in their wallet. The victim gets a DM if possible ("You were robbed!"). A per-server toggle (`guild_settings.robbery_enabled`, default on; dashboard Economy tab) lets a server turn robbery off entirely. Logged as `rob_win` / `rob_loss` / `rob_fine` in `economy_transactions`; recent robs are listed on the dashboard Economy tab.

## Reminders, reports, verify anywhere, lockdown, birthdays, counting leaderboard, confessions setup, social actions, quests, role shop, custom colors, weather home, translate menu, temp VC setup, emoji steal (v1.13.x)

- **Reminder management (v1.13.0):** `/tools remind set <time> <text>` (same time formats as `/tools remindme`), `/tools remind list` shows your pending reminders with IDs and relative due times, `/tools remind cancel <id>` cancels one of your own. Delivery still goes through the 1-minute scheduler loop (DM, falling back to the channel where it was set); reuses the `reminders` table.
- **AFK list (v1.13.1):** `/tools afk-list` shows everyone currently AFK in the server with their reason and how long they have been away.
- **User reports (v1.13.2):** `/mod report submit @user <reason> [evidence]` saves a report (`reports` table) and posts it to the modlog channel set with `/mod modlog-setup` (falling back to the core log channel). `/mod report list` (Manage Messages) shows open reports. Self-reports and bot reports are refused.
- **Verify from anywhere (v1.13.3):** `/verify verify` reports if you are already verified, otherwise sends you a working Verify button (captcha mode opens the math-question modal, same as the panel).
- **Channel lockdown (v1.13.4):** `/mod lockdown lock [channel] [reason]` (Manage Channels) stops @everyone from sending messages — the previous overwrite is stored and restored exactly by `/mod lockdown release`; `/mod lockdown status` lists locked channels (`lockdowns` table).
- **Birthday today/next (v1.13.5):** `/birthday birthday today` lists today's birthdays; `/birthday birthday next` shows the next upcoming birthday and how many days away it is.
- **Counting leaderboard (v1.13.6):** `/counting leaderboard` shows the current count, the highest count, and the top 10 counters. Correct counts are tracked per user in `counting_counts` (no backfill from past games).
- **Confessions setup (v1.13.7):** admin-only `/fun confess-setup` sets the confessions channel, approval requirement (default true), and enabled state in Discord.
- **Social actions (v1.13.8):** `/fun ship @user [@user2]` gives a deterministic compatibility % (same pair, same score) as a public embed with a percentage bar. `/fun hug`, `/fun kiss`, `/fun slap @user [message]` fetch a GIF from the free, no-key nekos.best API and post it publicly; API failures get a clear error embed instead of a crash.
- **Daily quests (v1.13.9):** `/economy quest list` shows today's 5 quests (claim `/economy daily`, work a shift, use 5 slash commands, 10 voice minutes, play a casino game); `/economy quest claim [quest]` claims one, or all completed ones if omitted. Each pays 50–100 coins + 20–30 XP; one claim per quest per day (`user_quests` table).
- **Role shop (v1.13.10):** `/economy roleshop list` / `buy <role>` spends wallet coins for a one-time role purchase; `/economy roleshop add <role> <price>` / `remove <role>` are admin-only. The role is granted before any coins are taken, and a failed purchase record refunds the charge and removes the role. Listings in `roleshop_items`, purchases in `roleshop_purchases`.
- **Custom color roles (v1.13.11):** `/role color custom <hex>` creates or recolors a personal color role (`color-<your user id>`) in any `#RRGGBB` color, positioned below the bot's highest role. It shows in `/role color list`; `/role color remove` deletes it entirely. Tracked in `user_color_roles`.
- **Weather home location (v1.13.12):** `/weather home set <location>` / `clear` / `view` saves a personal home location (`user_weather` table); bare `/weather weather` uses home first, then the server default.
- **Translate context menu (v1.13.13):** right-click a message → Apps → "Translate message" translates it into the server's auto-translate target language (English by default) and replies ephemerally with original + translation.
- **Temp VC setup (v1.13.14):** admin-only `/tempvc setup` sets the create channel, optional category, and on/off in Discord instead of only on the dashboard.
- **Emoji steal (v1.13.15):** `/emoji steal-emoji <emoji> [name]` (Manage Emojis) copies a custom emoji from another server — or an image URL — into this server, with the same validation as `/emoji add` and logging to `emoji_logs`.

## Stream checks, reaction-role pause, member logging, autoresponder, antispam, content filter, safety status (v1.14.x)

- **Stream check (v1.14.0):** admin-only `/stream check <platform> <channel>` forces an immediate live check for a watched streamer. A fresh offline → live transition posts the announcement (embed + latest clip/video, same as the poller); an already-live streamer reports its status without a duplicate post. TikTok/Facebook return the manual-only note — there is no public live API for them, and the bot does not fake one with scraping. Uses the dashboard Refresh helper (`checkOneStreamer`).
- **Reaction-role pause (v1.14.1):** admin-only `/reactionroles toggle <message_id> <enabled>` pauses or resumes all buttons on one reaction-role message (`reaction_roles.enabled`). While paused the buttons render disabled and stale clicks get an ephemeral refusal; mappings and requirements are untouched.
- **Member + moderation logging (v1.14.2):** admin-only `/mod logging setup <channel> [joins] [leaves] [bans] [kicks] [timeouts] [roles]` and `/mod logging status` (`logging_settings` table). Logs joins (with account age + member count), leaves, bans/unbans (with reason), kicks (told apart from leaves via the audit log — needs View Audit Log, otherwise every removal logs as a leave), timeouts (with end time), and role changes (added/removed names). Message deletes/edits stay on the modlog; Automod actions stay on the Automod log channel.
- **Autoresponder (v1.14.3):** admin-only `/tools autoresponder add <trigger> <response> [match] | remove | toggle | list` (`autoresponders` table). Fires when a phrase appears anywhere in a message (`contains`, default) or only when the whole message is the trigger (`exact`). Different from `/custom add`, which only fires on a single trigger word at the start. Replies go through the shared "handled" marker, so a message gets at most one auto reply (custom command, FAQ, or autoresponder), and Automod-deleted messages never get one.
- **Antispam detectors (v1.14.4):** see Automod section — `/automod antispam` adds duplicate, caps, mention, and link-count detection on top of the rate limit, with per-detector toggles/thresholds and a shared action (new columns on `automod_settings`).
- **Content filter (v1.14.5):** see Automod section — `/automod content-filter add|remove|list` for blocked words and harmful-link domains, each with its own action and severity (`content_filter_rules` table). Merges the harmful-content and keyword-protection asks into one system instead of two overlapping lists.
- **Safety status (v1.14.6):** admin-only `/mod safety-status` — one read-only overview: Automod + antispam state, content-filter counts, member-logging setup, autoresponder count, reaction-role mappings, stream watchers, and Automod actions in the last 24h by action.
- **Ubuntu server deployment (no version change):** full guide at [`docs/deployment/ubuntu-nginx.md`](docs/deployment/ubuntu-nginx.md) — Node.js 20 + MySQL install, cloning, the setup wizard through your domain, `npm run deploy` / `npm start`, systemd services for the bot and dashboard, Nginx (config already in `deploy/nginx/ace-bot.conf`), and free HTTPS via Certbot.

## Wordle, event scheduler, slowmode presets, AFK voice, image starboard, status roles, snipe, embed builder (v1.7.x)

- **Wordle / daily games (v1.7.1):** `/fun wordle` — one game per user per day, same word for everyone in the server (seeded from date + guild id, like daily trivia). Guess via modal (5 letters, 6 guesses), green/yellow/grey-square feedback, win/lose embed, streak tracked (consecutive winning days; a loss or missed day resets to 0). `/fun wordle-leaderboard` shows top streaks/wins. The word list is `src/data/words.json`: 1,200 common answers + 14,855 allowed guesses, from the open tabatkins/wordle-list and first20hours/google-10000-english lists — not hand-written. Games in `wordle_games`. Dashboard Games tab shows today's word (staff only) and the leaderboard.
- **Event scheduler (v1.7.2):** `/tools event create <title> <date/time> [description] [channel]` (staff) posts an embed with Going / Maybe / Can't go buttons; `/tools event list`, `/tools event cancel <id>` (admin). A 1-minute timer sends RSVP'd members (Going/Maybe) a DM reminder 1 hour before — channel mention if their DMs are closed — and posts a "starting now" message in the channel. Events in `scheduled_events`, RSVPs in `event_rsvps`. Dashboard Events tab lists upcoming events with RSVP counts and can create/cancel them.
- **Slowmode presets (v1.7.3):** `/mod slowmode set <seconds> [channel]` (admin) applies immediately; `/mod slowmode-schedule <channel> <day_seconds> <night_seconds> <night_start> <night_end>` (admin) sets a day/night schedule — a 15-minute timer applies the right value for the current hour. `/mod slowmode-schedule-remove <channel>` (admin). Schedules in `slowmode_schedules`; dashboard Moderation tab lists and edits them.
- **AFK voice kick (v1.7.4):** `/mod afkvoice-setup` (admin) enables it, sets the minutes threshold (default 30) and the AFK channel (blank = disconnect instead). On voice state changes the bot tracks when a member goes mute/deafened; a 5-minute timer moves members muted/deafened continuously longer than the threshold to the AFK channel. Never moves bots, members already in the AFK channel, or holders of a configurable exempt role. Moves logged to `afk_voice_moves` + modlog if set. Dashboard Moderation tab has the settings.
- **Image-only starboard (v1.7.5):** `/starboard image-setup` (admin) sets a separate image channel + threshold (default 3). Same star-reaction flow as the main starboard, but only messages with image/video attachments qualify — they post as a large-image embed in the image channel. If no image channel is set, image posts go to the main starboard as before. Settings in `guild_settings` (`image_starboard_channel_id`, `image_starboard_threshold`); dashboard Starboard tab.
- **Custom status roles (v1.7.6):** `/role statusrole add <text> <role>` (admin), `/role statusrole remove <text>`, `/role statusrole list`. On presence update, if a member's custom status contains the trigger text (case-insensitive) the role is granted; when it stops containing it, the role is removed. A 10-minute sweep catches missed updates. Guards: the role must sit below the bot's highest role; bots never get status roles. **Honest note: custom statuses only update when Discord sends a presence update, so there can be a delay.** Rules in `status_roles`; dashboard Roles tab lists them with add/remove.
- **Snipe (v1.7.7):** `/mod snipe [channel]` and `/mod editsnipe [channel]` (staff only) show the last deleted message / last edited message's before-and-after as an embed. **In-memory only — deleted message content is never written to the database or the error log**, kept per channel for 10 minutes. If nothing recent, the bot says so.
- **Embed builder (v1.7.8):** `/utility embed create` (admin) — modal (title, description, color), then a second modal for image/footer/channel — posts the finished embed to the chosen channel. `/utility embed edit <message_id or link>` (admin) edits an existing bot-posted embed in place. Built embeds stored in the `embeds` table; dashboard Embeds tab lists them with edit (form) and delete.

## Poll charts, ticket ratings, level-up announcements, invite rewards, AFK auto-create, bookmarks, auto-publish, re-engagement, rank card (v1.8.x)

- **Poll results chart (v1.8.1):** when a poll ends, the results message includes a bar chart (node-canvas — already installed for the welcome cards) with each option's vote count and percentage. `/tools poll-results <message_id or link>` shows any poll's results with the chart, live or ended. Final tallies are stored in `polls.final_counts` so results survive restarts (add the column on existing installs: `ALTER TABLE polls ADD COLUMN final_counts JSON NULL;`). Dashboard Polls tab shows past polls with charts.
- **Ticket ratings (v1.8.2):** when a ticket closes, the creator is DM'd a 1–5 star prompt (buttons) with an optional comment modal. If their DMs are closed the prompt is skipped silently and the skip is logged. `/ticket ratings` (staff) shows the average, count, and recent ratings with comments; dashboard Staff → Tickets page has the average card + ratings table. Ratings in `ticket_ratings`.
- **Auto-role on level — announcement side (v1.8.3):** level role rewards already auto-grant on level-up (v1.3.5) — this version adds the announcement channel. `/level levelup-channel set <channel>` (admin) picks where the bot posts an embed when someone levels up **and gains a role**; `/level levelup-channel view` / `clear` manage it. `/level levelrewards` already shows which roles auto-grant at which levels. Channel in `guild_settings.levelup_channel_id`; dashboard Leveling tab has the dropdown + reward roles list.
- **Invite rewards (v1.8.4):** `/invite invitereward add <invites> <role|coins> <value>` (admin), `/invite invitereward list`, `/invite invitereward remove <invites>`. When a member's valid invite count reaches a configured milestone, the reward (role or coins to their economy wallet) grants automatically — once per milestone — and they're DM'd, plus a post in the invite log channel if set. Fake joins never count. `/invite myinviterewards` shows progress to the next reward. Milestones in `invite_rewards`, grants in `invite_reward_grants`; dashboard Invites tab lists them with add/remove.
- **AFK voice channel auto-create (v1.8.5):** `/tempvc afkchannel-setup` (admin) sets the primary AFK channel and the max users (default 10). When the primary AFK channel reaches max users, the bot creates a second AFK voice channel ("AFK 2") in the same category; when it empties, it's deleted. If the primary is empty for 10 minutes and a secondary exists and is also empty, the secondary is deleted. Settings in `guild_settings` (`afk_autocreate_enabled`, `afk_channel_id`, `afk_max_users`); dashboard Temp VC tab.
- **Message bookmarks (v1.8.6):** `/tools bookmark add <message_id or link> [note]` saves a message to your own list (only messages in channels you can read); `/tools bookmark list` lists yours (ephemeral, with jump links); `/tools bookmark remove <id>` removes one. A message context-menu command "Bookmark message" is also registered. **Only a 500-character excerpt is stored** — never the full message body. Bookmarks in `bookmarks`.
- **Auto-publish announcements (v1.8.7):** `/tools autopublish add|remove|list` (admin) manages announcement channels that auto-publish. Messages posted in a configured announcement channel (type GUILD_ANNOUNCEMENT) are crossposted automatically. Bot messages and already-published messages are skipped; failures go to the error log. Channels in `guild_settings.autopublish_channels` (JSON); dashboard Announcements tab.
- **Inactive-member re-engagement (v1.8.8):** `/tools reengage-setup enable [days] [channel]` (admin) turns on a daily job (10:00) that DMs members inactive for N days (default 30) a friendly "we miss you" message — at most once per member per 30 days, never bots, never members who joined less than N days ago, never members who opted out with `/tools reengage-optout`. `/tools reengage-preview` (admin) shows who would be messaged without sending anything. Activity is read from the data the bot actually records: `user_levels.last_xp_at` (last message that earned XP), `voice_sessions` (last voice session), `user_stats.last_seen` (last slash-command use). Logs in `reengage_logs`, opt-outs in `reengage_optouts`; dashboard Analytics page shows the inactive count.
- **Rank card image (v1.8.9):** `/level rank` now posts a 900×300 rank card image (avatar, username, level, XP progress bar, leaderboard rank, total messages) in the same theme as the welcome card, reusing the canvas setup — the text embed is the fallback if canvas fails. Total messages counts every message since this feature was added (`user_levels.messages`; add the column on existing installs: `ALTER TABLE user_levels ADD COLUMN messages INT UNSIGNED NOT NULL DEFAULT 0;`). Dashboard Leveling tab has a rank card preview with sample data.

## Reaction roles with requirements (v1.2.6)

`/reactionroles add` now takes optional `required_role`, `min_days`, and `min_level`. When a member clicks to take a role, the bot checks first: missing the required role, fewer days in the server than `min_days`, or a leveling level below `min_level` all block the grant, and the member gets an ephemeral embed naming **exactly** which requirement they missed. Removing a role never checks requirements. `/reactionroles list` and the dashboard Reaction Roles tab show each mapping's requirements. Stored in new `reaction_roles` columns (`required_role_id`, `min_days_in_server`, `min_level`).

## Tickets (Ticket Tool-style)

1. Run `/utility setup` (admin): set ticket category, support role, ticket log channel.
2. Run `/ticket setup` in the channel where the panel should live.
3. A user clicks **Create Ticket** → modal asks for a subject → a private channel `ticket-<username>-<number>` is created (creator + support role + admins only) with Close / Claim / Add User buttons.
4. **Close** locks the channel, asks for a reason, generates an **HTML transcript** (`transcripts/`, messages with author/avatar/timestamp/content/attachments), sends it to the ticket log channel + DMs it to the creator, and **deletes the channel after 60 seconds** unless reopened from the log channel's **Reopen** button.
5. Slash equivalents: `/ticket close`, `/ticket add`, `/ticket remove`, `/ticket claim` — all permission-checked (creator, support role, or admin).

## Server Stats (ServerStats-style)

`/utility serverstats-setup` (admin) creates a **📊 Server Stats** category with display-only voice channels (Connect denied) like `👥 Members: 1,234`, `🟢 Online: 567`, `🤖 Bots: 12`, `🏆 Boosts: 8`. `/utility serverstats-toggle` enables/disables individual stats (members, online, bots, boosts, channels, roles). Channels refresh every `serverStats.updateIntervalMinutes` (default 10), on joins/leaves, and on presence changes (debounced); renames only happen when the value actually changed. Channel IDs are stored in `guild_settings`, so they survive restarts and work per-shard (only the owning shard updates them). **Online needs the Guild Presences intent** (enabled in `index.js` + the Developer Portal).

## Streams

`/stream add` (admin): platform (`youtube`, `twitch`, `kick`, `facebook`, `tiktok`) + channel + notify channel + optional ping role. Checker runs every `streams.checkIntervalMinutes` (default 5) and posts a rich embed (title, game, thumbnail, viewers, link) **only on an offline → live transition** — never repeats. Going offline just updates the DB (no spam, unless `announceOfflineMessage` is on).
- **Twitch:** Helix API — get a client ID + secret at https://dev.twitch.tv (client-credentials flow, no user login needed). Fill in `streams.twitch`.
- **YouTube:** Data API v3 key from Google Cloud Console → `streams.youtube.apiKey`. Use the channel **ID** (UC…), not a handle.
- **Kick:** public API (`kick.com/api/v2/channels/<name>`) — no key needed. Note the endpoint may change; check Kick's docs if it breaks.
- **Facebook Live / TikTok:** honestly, **no simple public live-status API exists** (TikTok's LIVE API is partner-only). They are stored but never auto-checked — use `/stream announce` (platform + URL + optional title) to announce them manually.
- Missing credentials = that platform is skipped with a startup warning; the others keep checking.
- **Check now (v1.14.0):** `/stream check <platform> <channel>` forces an immediate live check for a watched streamer instead of waiting for the next poll. A fresh offline → live transition posts the announcement to the notify channel; TikTok/Facebook return the manual-only note.
- **Dashboard:** the Streams tab manages watchers in the GUI — list (live dot, platform, notify channel, ping role, live channel), add form, edit notify/ping/live channel per streamer, and a **Refresh** button that re-checks that streamer now. Same `streamers` table as Discord, so both stay in sync.
- **Live channel name:** `/stream add` (and the dashboard) take an optional `live_channel` — a voice or text channel whose **name** updates on transitions. Live: renamed to the template (default `🔴 LIVE: {name}`); offline: restored to its original name (stored in `streamers.live_channel_original_name` when first renamed — never guessed). Only one streamer per live channel (both Discord and dashboard refuse a clash). Renames happen only on state changes, never every check; Discord allows ~2 renames per 10 min per channel, so a failed rename is logged and retried on the next check instead of crashing.
- **Per-server template:** the template is stored in the **database** (`guild_settings.live_channel_name_template`) — set it on the dashboard Streams tab (with live preview) or with `/stream template view|set|reset` (admin). Placeholders: `{name}` (required), `{game}`, `{title}`; max 100 chars, one line. `config.json` `streams.liveChannelNameTemplate` is only the global fallback for servers that never set their own. Migration for existing installs: `ALTER TABLE guild_settings ADD COLUMN live_channel_name_template VARCHAR(100) NULL; ALTER TABLE streamers ADD COLUMN live_channel_id VARCHAR(32) NULL, ADD COLUMN live_channel_original_name VARCHAR(100) NULL;`

## Leveling / XP

Members earn **15–25 XP per message** with a **60s cooldown** (configurable under `leveling`). Level curve: XP needed for level N = **100 × N^1.5** (level 1 = 100 XP, level 5 ≈ 1,118 XP total). Level-up messages post in-channel (toggleable per guild, `levelUpMessages` in `guild_settings`). Stored in MySQL `user_levels`. Commands: `/level rank` (level, XP, progress bar, server rank), `/level leaderboard` (top 10), `/level setlevel` (admin). **Role rewards:** `guild_settings.level_roles` JSON maps level → role ID (dashboard → Leveling) — granted automatically on level-up.

## Steam

`/steam linksteam <Steam ID / vanity / profile URL>` stores your SteamID in `user_links`; `/steam steam [user] [steam]` shows name, avatar, online status, currently-playing game, and profile link. Needs `steam.apiKey` — get one free at https://steamcommunity.com/dev/apikey. Without a key, the commands reply that Steam isn't configured.

## Giveaways

`/giveaway start <prize> <duration 10m/1h/1d> [winners] [required role] [channel]` posts an embed with a **🎉 Enter** button (one entry per user, stored in `giveaway_entries`). A 30-second timer ends expired giveaways, picks random winner(s), announces them in the channel, and DMs winners. `/giveaway end <id>` ends early, `/giveaway reroll <id>` picks new winner(s), `/giveaway list` shows active giveaways.

## Reaction Roles

`/reactionroles setup` (admin) posts a message with emoji **buttons** mapped to roles; clicking toggles the role. `/reactionroles add` / `-remove` / `-list` manage pairs on an existing message. Mappings live in MySQL `reaction_roles`. Button-based only (no classic reactions) — reliable and needs no extra intent.
- **Pause/resume (v1.14.1):** `/reactionroles toggle <message_id> <enabled>` pauses a whole reaction-role message — buttons render disabled and stale clicks are refused — without deleting any mappings (`reaction_roles.enabled`).

## Game Server Status (pluggable providers)

`src/utils/gameServers.js` is a **provider registry**: each provider is `{ id, name, query(host, port) }`. Shipped providers:
- `minecraft` — Java server-list ping (players, version, MOTD).
- `source` — A2S query, covers **Rust, CS2, TF2, Garry's Mod, ARK, Valheim**, etc.
- `http` — generic JSON endpoint (`extra.endpoint` + JSON paths for players/maxPlayers/online).
- `manual` — no query protocol; status is informational only, never faked.

**Adding a new game without code:** pick an existing provider — either in `config.json` `gameServers.custom` (`[{ id, name, provider, host, port }]`) or per-server with `/gameserver add` (admin, stored in the `game_servers` DB table). **Adding a new provider:** one function + one registry entry in `src/utils/gameServers.js` (documented in the file header).
**The Isle limitation:** The Isle Evrima has **no public query protocol**, so it is `manual` status only — the bot will not claim it is online/offline. It is pre-configured as an example in `config.example.json` with placeholder values (not a real IP).
Commands: `/gameserver serverstatus [game]` (live embed, one game or all), `/gameserver add`, `/gameserver remove`, `/gameserver list`. A checker runs every `gameServers.checkIntervalMinutes` (default 5), stores history in `game_server_status`, and posts online/offline transitions to the per-server notify channel if set. Dashboard → Game Servers lists tracked servers per guild.

## Owner commands

Checked against `ownerId` in `config.json` (anyone else gets an ephemeral owner-only embed; the owner ID is never leaked). `/owner restart` — under the ShardingManager it respawns the current shard; unsharded it destroys the client and exits so a **process manager** (pm2/systemd/Docker) can restart it (without one, start it again manually). `/owner reload <command>` hot-reloads one command file (slash *definitions* still need `npm run deploy`). `/owner shutdown` — graceful shutdown (closes DB pool, exits 0). `/owner eval <code>` — evaluates JS, output truncated to 1900 chars in a code block. **Security warning: /owner eval can run anything — owner-only for a reason. Never set ownerId to anyone else.**

## Dashboard (Dyno-style web GUI)

`npm run dashboard` → http://localhost:3010. **Auth:** Discord OAuth2 (same app as the bot). Log in, and the dashboard fetches your guilds — it shows **only guilds where you have Manage Guild AND the bot is a member**. No login = no access.
**Setup:** in the Developer Portal → OAuth2, add redirect URI `http://localhost:3010/callback` (or your `dashboard.redirectUri`), copy the **Client Secret** → `config.json` `dashboard.clientSecret`, and set a long random `dashboard.sessionSecret`. Fill `dashboard.port` (default 3010).
**Pages:** Home / server picker (grid with icons) → per-server settings, one page per module: General (welcome/log channels, embed color), Moderation (warn threshold + auto-action, log channel), Tickets (category, support role, log channel, recent tickets), Server Stats, Streams (list/add/remove), Music (DJ role), Leveling (level-up messages, role rewards), Reaction Roles, Game Servers. **Add to Server** button is in the header on every page and on the home page — it opens Discord's OAuth2 invite flow in a new tab, built from `config.json` `clientId` (never hardcoded) with `dashboard.invitePermissions`.
**API:** `GET/POST /api/guilds/:id/settings`, `/api/guilds/:id/streamers`, `/api/guilds/:id/tickets` — all auth-checked per guild, inputs validated server-side (channels/roles must actually exist in that guild). Security: express-session + Helmet + rate limiting; the bot token and DB password are **never** in frontend code or API responses. The dashboard reads/writes the same MySQL tables as the bot, and the bot picks up changes within 60s (settings cache TTL).

## Invite link & permissions

The invite URL is `https://discord.com/oauth2/authorize?client_id=<clientId>&permissions=1099951041558&scope=bot%20applications.commands`, built from config (`dashboard.invitePermissions`, default **1099951041558**). Permissions included and why:
- Manage Channels (16) — ticket + stat channels; Manage Roles (268435456) — leveling/reaction-role grants; Kick (2), Ban (4), Moderate Members/timeout (1099511627776) — moderation; Manage Messages (8192) — /mod clear; View Channels (1024), Send Messages (2048), Embed Links (16384), Attach Files (32768) — reading/sending embeds + transcripts; Connect (1048576), Speak (2097152), Use Voice Activity (33554432) — music voice; Manage Nicknames (134217728) — nickname moderation. Change the integer in `config.json` `dashboard.invitePermissions` without editing code.

## /utility ping (shard-aware)

`/utility ping` shows round-trip + API heartbeat for **this shard**, and lists **every shard** by ID with its own ping and guild count, one line per shard (e.g. `▶ Shard 0 — 42ms — 128 guilds`), with ▶/bold marking the shard that answered. Unsharded runs say so clearly. `/utility shards` is the detailed shard overview (count, per-shard guilds + latency).

## Nginx deployment (reverse proxy)

Serve the dashboard on a public domain over HTTPS with Nginx — this is also how the setup wizard is reached through a domain. Full walkthrough + config live in `deploy/nginx/` (`ace-bot.conf` + `README.md`). For the whole server setup (Node.js, MySQL, cloning, systemd, Nginx, HTTPS), see [`docs/deployment/ubuntu-nginx.md`](docs/deployment/ubuntu-nginx.md).
- **Config:** copy `deploy/nginx/ace-bot.conf` to `/etc/nginx/sites-available/ace-bot`, symlink it into `sites-enabled`, replace `bot.example.com` with your domain, `sudo nginx -t && sudo systemctl reload nginx`. The server block listens on 80 (redirects to HTTPS) and 443 with `ssl_certificate` placeholders, proxies `/` to `http://127.0.0.1:3010` with `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers, `proxy_http_version 1.1` + WebSocket Upgrade headers, and `client_max_body_size 10m`.
- **Free cert:** `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d bot.example.com` (fills in the cert paths and auto-renews).
- **Dashboard side:** set `dashboard.publicUrl` to `https://bot.example.com` (and `dashboard.setupViaDomain: true`) in `config.json`, and add `https://bot.example.com/callback` as an OAuth2 redirect in the Developer Portal. Express `trust proxy` is set (`app.set('trust proxy', 1)`), so secure session cookies work when `X-Forwarded-Proto` is `https`, and rate limiting (including the `/setup` limit) keys off the real client IP from `X-Forwarded-For`. OAuth redirect URI, invite links, and setup links use `dashboard.publicUrl` when set, falling back to `http://localhost:<port>`.
- **First-run via domain:** start the dashboard, copy the one-time token from the console output or `setup-token.txt`, and open `https://bot.example.com/setup?token=<token>`.

## How to add a new command

1. Create `src/commands/<category>/<name>.js` exporting `{ data, execute }` (see any existing command).
2. **Reply with embeds only** — use `src/utils/embeds.js` (`successEmbed` / `errorEmbed` / `infoEmbed`).
3. Run `npm run deploy` and restart the bot. The handler auto-loads it.

## Staff area (dashboard) + command/feature toggles

The dashboard has a **Staff** area, visible only to the bot owner (`ownerId`) and approved staff — regular server managers never see the link, and hitting the URL directly returns 403.
- **Access control:** `staff_users` table (`user_id`, `added_by`, `role` owner/admin/staff) + `src/utils/staff.js` (`isOwner`, `isStaff`, `listStaff`, `addStaff`, `removeStaff`). The owner is always staff implicitly. Bootstrap: list Discord user IDs in `config.json` `staffUserIds`; after that, the owner manages staff on the Staff → Staff Management page (owner only — add by user ID, set role, remove). Every staff change is logged to `staff_audit`.
- **Bot overview:** total guilds/users, commands run, songs played, top commands, top guilds, recent command logs (last 50) and recent errors. Shard/live status shows "bot not connected" when the dashboard runs standalone (it is a separate process from the bot) — totals come from MySQL.
- **Command management:** a table of every command with a global enable/disable toggle (`command_toggles`: global `guild_id = ''` or per-guild). The bot's `interactionCreate` checks the toggle before running any command (global off = disabled everywhere; guild off = disabled in that guild) and replies with a "this command is disabled" embed. Per-guild toggles are on each server's **Commands** tab.
- **Feature management:** whole-module toggles (`feature_toggles`): music, tickets, leveling, giveaways, streams, game servers, server stats, reaction roles, applications, invites, welcome, automod, suggestions — global and per-guild. Enforced in command handlers and background jobs (music disabled = `/music play` refuses; streams disabled = the checker skips that server).
- **Broadcast (owner only):** send an embed announcement to one server + channel, or to a channel *name* in every server. Requires a confirm checkbox, sends are spaced out for rate limits, and every broadcast is logged to `broadcasts` + `staff_audit`.
- **Errors page:** see the Error Logging section below. **Backups page:** see Backups below.

## Applications (Appy-style)

`/application create` (admin) creates a form: pick the review channel + optional role-to-grant, then a modal asks for name, description, and up to 5 questions (one per line). `/application list` (staff), `/application open` / `/application close` (admin, by form ID). Members run `/application apply` — a select menu of open forms, then a modal with the form's questions. On submit the application is saved as `pending` and an embed with the answers + **Accept / Deny** buttons is posted to the review channel. Accept grants the configured role, DMs the applicant, and marks it accepted; Deny asks for a reason via modal and DMs the denial + reason. Slash equivalents: `/application accept <id> [note]`, `/application deny <id> [reason]`, `/application view <id>` (staff), `/application status` (your own). Reviewers = admins or the `applicationReviewerRoleId` role (set in the dashboard → Applications, stored in `guild_settings`). Dashboard Applications tab: list/create/open/close forms and a review queue with Accept/Deny buttons (role grant + DM done via Discord REST). Tables: `application_forms`, `applications`.

## Invite tracker

On startup and on InviteCreate/InviteDelete, the bot caches each guild's invites (code → uses, inviter). On `guildMemberAdd` it compares cached uses to the live list — the invite whose use count went up is the inviter — and records it in `invite_uses`, updating the inviter's aggregates in `user_invites` (total / valid / leaves / fake). On `guildMemberRemove` it marks `left_at` and decrements valid invites. An invite log message goes to `guild_settings.inviteLogChannelId` (or the welcome channel), saying who invited them and the inviter's total.
- **Fake invites:** joins from accounts younger than the threshold are flagged fake (`invite_uses.is_fake`) and don't count toward valid invites. Threshold: `config.json` `invites.minAccountAgeDays` (default **7**), overridable per server on the dashboard Invites tab (`invite_min_account_age_days`).
- **Vanity URL:** if the guild has a vanity URL and its use count rose, the join is counted as vanity (no specific inviter) and shown in stats.
- **Requirements:** the bot needs **Manage Server** permission to fetch invites — without it, joins show as "unknown invite".
- Commands: `/invite invites [user]` (total/valid/leaves/fake), `/invite inviteleaderboard` (top 10 by valid invites), `/invite info <code>` (who made it, uses, channel, max uses), `/invite reset [user] [confirm:true]` (admin, confirm required). Dashboard Invites tab: leaderboard, per-user stats table, log channel + fake-threshold settings.

## Error logging (staff)

`src/utils/errorLogger.js` is the single place errors go — every part of the bot uses it instead of `console.error` alone. Each entry: timestamp, level (`error`/`warn`/`info`), shard id, guild id, command/event name, user id, message, stack trace, context object.
- **Storage — every error, no exceptions:** each entry is written to the MySQL `error_logs` table (no sampling, no dropping — error and warn both go in) **and** to a local rotating log file `logs/bot-errors.log` (one JSON line per entry, so errors survive a DB outage). If the DB is down when an error occurs, the entry is queued in memory and **backfilled** into `error_logs` once the DB reconnects (retry every 60s + after each successful insert).
- **Redaction:** any field whose name matches token/password/secret/key/api-key/auth is replaced with `[REDACTED]` before storage or file write. Message content is never logged wholesale.
- **Coverage:** `unhandledRejection` + `uncaughtException` handlers in `index.js` and `shardManager.js`; shard disconnect/death/error events; the `interactionCreate` try/catch (command errors keep the user-facing "something went wrong" embed); music player errors, stream-check failures, ticket transcript failures, dashboard 500s (error middleware).
- **Staff visibility:** `/staff errors [level] [command]` (owner/staff — last 10, with time/command/message), `/staff error <id>` (full details incl. stack, truncated to fit), `/staff errors-clear [confirm:true] [scope: resolved|old|everything]` (owner only). Dashboard Staff → Errors: filterable table (level/command/shard), click for the full stack trace, **Mark resolved** action (`resolved` + `resolved_by` columns), and an error-count badge (last 24h) on the staff overview.

## Database backups (daily)

`scripts/backup-db.js` dumps the full database with `mysqldump` (credentials from `config.json`, passed via the `MYSQL_PWD` env var — never in argv or logs) to `backups/YYYY-MM-DD-HHmm.sql.gz`, and logs each run to `backup_logs` (filename, size, status, error). On failure it also logs to the error logger.
- **Schedule:** the bot runs it daily at `config.json` `backups.time` (default **03:00**) via `node-cron` (in-process, works out of the box). OS-cron alternative: `0 3 * * * cd /path/to/bot && npm run backup`.
- **Retention: 30 days** (`backups.retentionDays`, default 30) — after a successful new backup, files older than 30 days are deleted automatically.
- **Manual:** `/owner backup` (owner only) runs one now and replies with filename/size/status; the dashboard Staff → Backups page has a **Backup now** button, a file list with staff-only download links, and the run log.
- **Restore:** `node scripts/restore-db.js <file.sql.gz> --confirm` (interactive confirm if `--confirm` is omitted — restore overwrites the database), or manually: `gunzip -c backups/<file> | mysql -u <user> -p <database>`.
- **Safety:** `backups/` and `logs/` are in `.gitignore` and are never uploaded to Google Drive; backup filenames and logs never contain credentials.

## Welcome & goodbye messages

Welcome and goodbye messages are per server, stored in `guild_settings` (`welcome_channel_id` / `welcome_message` / `welcome_enabled`, `goodbye_channel_id` / `goodbye_message` / `goodbye_enabled`). On `guildMemberAdd` the bot posts an embed with the welcome template in the configured channel; on `guildMemberRemove` it posts the goodbye template. Placeholders: `{user}` (mention), `{username}`, `{server}`, `{membercount}`. If no channel is set (or the feature is toggled off) nothing is sent; if the bot can't post there, the failure is logged via the error logger and skipped, never fatal.
- Commands (all admin, all replies ephemeral): `/welcome setup <channel> [message]` (sets the channel + template, shows a preview), `/welcome toggle <enabled>`, `/welcome goodbye-setup <channel> [message]`, `/welcome goodbye-toggle <enabled>`, `/welcome test` (posts a preview welcome for yourself in the welcome channel).
- Dashboard Welcome tab: channel dropdowns, message template fields with live previews, enable toggles. The General tab's welcome-channel field edits the same setting.

**Welcome DMs (v1.9.3)** are a separate per-server setting, stored in `guild_settings` (`welcome_dm_enabled`, `welcome_dm_message`). On `guildMemberAdd` (after the channel welcome) the bot DMs the new member an embed with the template; placeholders: `{user}` (mention), `{username}`, `{server}`. If DMs are disabled, no message is set, or the member's DMs are closed, nothing is sent — closed DMs are logged via the error logger and skipped, never fatal.
- Commands (all admin, all replies ephemeral): `/welcome dm set <message>` (sets the DM template and enables DMs, shows a preview), `/welcome dm toggle <enabled>`.
- Dashboard Welcome tab: DM message field with live preview, enable toggle, and a test button that DMs the admin a preview.
- Existing installs: the new `guild_settings` columns are in `sql/schema.sql`, but `CREATE TABLE IF NOT EXISTS` won't add columns to an existing table — run the `ALTER TABLE` in the migration note at the bottom of `schema.sql` once.

## Automod

Spam detection, banned-words filter, and link / Discord-invite blocking, all per server in `automod_settings` (one row per guild) with every action logged to `automod_actions` (guild, user, action, reason, message excerpt) + optionally to a log channel. The `messageCreate` handler runs Automod before XP awarding — a deleted message earns no XP.
- **Spam:** X messages in Y seconds (default 5 in 5s) per user per guild, tracked in memory (windows pruned per check; the DB log is the permanent record). One burst = one action, then the window resets.
- **Banned words:** word-boundary match (so "class" doesn't trip on "ass"), configurable list.
- **Links:** deletes messages containing `http(s)` links when `block_links` is on. **Invites:** deletes `discord.gg` / `discord.com/invite` links when `block_invites` is on (default on; checked before generic links so the reason is exact).
- **Action:** the configured `spam_action` applies to every Automod hit — `delete`, `warn`, `timeout`, `delete_warn` (default), `delete_timeout` (timeout length in minutes, default 10). Warns go through the shared warns store (`src/utils/warns.js`).
- **Antispam detectors (v1.14.4):** `/automod antispam` adds duplicate-message (same text 3× in 60s, default), ALL-CAPS (70%+ uppercase, 10+ letters, defaults), mention-spam (max 5, default), and link-count (max links per message, off by default) detection — each toggleable with its own thresholds, sharing one `antispam_action` (new columns on `automod_settings`).
- **Content filter (v1.14.5):** `/automod content-filter add|remove|list` — blocked words (word-boundary match) and harmful-link domains (hostname + subdomains), each with its own action and severity (`low`/`medium`/`high`) in `content_filter_rules`. Checked after the spam detectors, before the legacy banned-words list. No built-in word list ships with the bot — each server defines its own entries.
- **First match wins:** rate spam → antispam detectors → content filter → banned word → invite → link. One action per message.
- **Exemptions:** admins are always exempt; exempt roles and exempt channels (via `/automod exempt` or the dashboard) bypass every check.
- Commands (all admin, all replies ephemeral): `/automod automod` (view settings), `/automod setup` (spam limits, action, timeout length, link/invite toggles, log channel), `/automod words add|remove|list`, `/automod exempt add-role|remove-role|add-channel|remove-channel|list`, `/automod antispam` (detectors + thresholds + action; no options = show current settings), `/automod content-filter add|remove|list`. Dashboard Automod tab: the same controls plus a recent-actions table.
- Pure detectors (`detectSpam`, `containsBannedWord`, `containsLink`, `containsInvite` in `src/utils/automod.js`) are exported for testing without a live Discord login.

## Suggestions

Members submit ideas with `/suggest suggest` (modal: title + details). The suggestion is saved to MySQL (`suggestions`) and posted as an embed in the configured channel (`guild_settings.suggestion_channel_id`, set by `/suggest suggestions-setup`, admin) with 👍/👎 vote buttons and Approve / Deny / Mark implemented review buttons.
- **Voting:** one vote per user, changeable — voting the same way again removes your vote. Counts are recalculated from `suggestion_votes` on every vote and the embed is edited in place, so the DB and the embed can never drift.
- **Review:** admins or the application reviewer role (`application_reviewer_role_id`) can approve/deny/mark implemented from the embed buttons or the dashboard Suggestions tab (status filter + review buttons). Reviewing updates the status, edits the embed (buttons removed once decided), and DMs the suggester.
- Commands: `/suggest suggest` (any member — modal; the confirmation reply is ephemeral, the suggestion post itself is public), `/suggest suggestions-setup <channel>` (admin), `/suggest status` (your own suggestions, ephemeral). Dashboard Suggestions tab: channel setting, list with status filter, Approve/Deny/Implement buttons (embed edited + DM sent via Discord REST).

## Economy

Per-server currency, all in MySQL (`economy_users` wallet + bank, `economy_transactions` audit trail, `shop_items`). New users start with the configured starting balance (default 100 coins, global default in `config.json` `economy.startingBalance`).
- **Earning:** `/economy daily` (once per 24h, random 100–500 coins by default), `/economy work` (once per hour — pays from your chosen job's range, or 50–250 coins + a random job flavor line with no job). Amounts are per-server settings (dashboard Economy tab). See **Work jobs (v1.12.3)** below.
- **Spending / moving:** `/economy pay @user amount` (wallet to wallet — no negatives, can't pay yourself or bots), `/economy deposit [amount]` and `/economy withdraw [amount]` (wallet ↔ bank; no amount = all), `/economy shop` (list; `/economy shop buy:<id>` buys it) and `/economy shop-add` (admin — name, price, optional description and role granted on purchase).
- **Checking:** `/economy balance [user]` (wallet, bank, total), `/economy eco-leaderboard` (top 10 richest by wallet + bank).
- Dashboard Economy tab: starting balance, daily/work min–max, currency name/emoji, and shop-item management (add/remove). All economy command replies are ephemeral.

## Casino

Casino games spend the **same wallet balance** as the rest of the economy (`economy_users.balance` — no second currency, no separate balance). Earn coins with `/economy work` and `/economy daily`, then gamble them. The bank does **not** count toward a bet — use `/economy withdraw` first if your coins are in the bank.
- **Games:** `/casino slots <bet>` (3-reel 🍒🍋🍇💎7️⃣⭐ — three of a kind: 💎💎💎 x10, 7️⃣7️⃣7️⃣ x7, any other trio x5; two of a kind x2), `/casino blackjack <bet>` (Hit / Stand buttons, dealer draws to 17, blackjack pays 3:2, win x2, push returns the bet), `/casino roulette <bet> <red|black|green|number 0-36>` (red/black x2, green 0 x14, exact number x35), `/casino gamble-coinflip <bet> <heads|tails>` (x2), `/casino gamble-dice <bet> <1-6>` (exact guess x5).
  - `/fun coinflip` and `/fun dice` (fun commands, no bet) still exist unchanged — the casino versions are the separate `/casino gamble-coinflip` and `/casino gamble-dice` commands so the fun ones never touch your balance.
- **Limits:** minimum bet 10 coins, maximum bet 10,000 coins (global defaults `config.json` `economy.minBet` / `economy.maxBet`). The bet is deducted **before** the game resolves and winnings are credited after, so a lost bet is already gone if the bot restarts mid-game. Every win/loss is written to `economy_transactions` (`casino_win` / `casino_loss`, plus `casino_push` for a blackjack push).
- **Cooldown:** 5 seconds between casino games per user (in-memory; it only makes you wait, never bans). All casino replies are ephemeral — only you see your results. A blackjack hand auto-stands after 2 minutes of no button press.

## Inventory, crates & daily items

The shop is also an inventory system. Buying a non-role item puts it in your inventory (`inventory_items` table); role items still grant the Discord role directly. Everything uses the same wallet balance as `/economy work`, `/economy daily`, and the casino.
- **Item types** (`shop_items.type`): `role` (grants `role_id`), `crate` (opened with `/economy open-crate`), `consumable` (used with `/economy use`), `collectible` (inventory only). `/economy shop-add` takes `type`, `emoji`, `sell_price`, and `crate_contents` (JSON) options.
- **Crates:** Common (500), Rare (1,500), Legendary (5,000) — prices in `config.json` `economy.crates`. The three defaults are auto-created in a guild's shop the first time anyone opens `/economy shop` (or claims `/economy daily`). `/economy open-crate <item id>` rolls one weighted reward from the crate's `crate_contents` (coins and/or other shop items by name) — 10s cooldown per user. Crate contents format: `[{"kind":"coins","min":50,"max":150,"weight":60},{"kind":"item","item_name":"Rare Crate","weight":10}]`. Missing named rewards fall back to 100 coins.
- **Daily items:** `/economy daily` grants coins plus one random daily reward. Loot table: 50% +50–150 bonus coins · 25% Common Crate · 15% Lucky Coin (consumable) · 7% Rare Crate · 2.5% Legendary Crate · 0.5% 2,500-coin jackpot.
- **Daily deal:** one random shop item per guild per day is 25% off for everyone in that guild (`daily_deals` table, rotates at midnight) — highlighted with ⭐ in `/economy shop`, and `/economy buy` charges the discounted price.
- **Buy & sell:** `/economy buy <item id> [quantity]` (wallet only; role items are one-at-a-time and refused if you already have the role), `/economy sell <item id> [quantity]` (sell-back price is the item's `sell_price`, or half the buy price by default — never above the buy price), `/economy inventory [user]` (items, quantities, sell values, wallet/bank). Role items can't be sold — they live as Discord roles, not inventory. Transactions: `shop_buy` / `shop_sell` / `crate_open` in `economy_transactions`.
- **Consumables:** `/economy use <item id>` spends one. Currently only the Lucky Coin has an effect (random 50–200 coins); other consumables are kept, not consumed, until an effect is added for them.

## Player-to-player trading

`/economy trade @user` proposes a swap where **both sides offer something** — what you give (`give_coins` / `give_item` / `give_qty`) and what you want (`get_coins` / `get_item` / `get_qty`). Flow: (1) the proposal is posted **publicly** in the channel so the partner sees it; (2) the partner clicks **Accept** (or Decline); (3) the proposer clicks **Confirm swap**. The swap runs inside a single MySQL transaction (`src/utils/trading.js` `executeTrade` via `db.withTransaction`): both sides' coins and items are re-validated and moved atomically, so a failed trade can't duplicate anything. Trades expire after 60s; `/economy trade-cancel [trade id]` (or the Cancel button) backs out — nothing is swapped. Logged as `trade` rows in `economy_transactions`. Role items can't be traded.

## Bot tracking

`src/utils/botTracker.js` scores every new member on join (0–100) and logs suspicious ones to `bot_flags` + daily counts to `bot_join_stats` (tables in `sql/schema.sql`).
- **Signals (points add up, capped at 100):** account age under 24h +40 (under 7 days +30) · default avatar +15 · username matches bot patterns (random letters/numbers, or nitro/steam/free/gift/crypto spam words) +25 · join burst — 5+ joins in 60s +25 · mass-join clustering — 3+ recent joins with accounts created within 10 minutes of each other +20.
- **Thresholds:** score ≥ threshold (config `botTracking.threshold`, default 70; per-guild override `guild_settings.bot_threshold`) = auto-action; 40–69 = watchlist (logged, no action); below 40 = clean, not logged.
- **Auto-action** (per guild, `guild_settings.bot_auto_action`): `flag` (default — log + optionally assign the Suspected Bot role, `guild_settings.bot_suspect_role_id`) / `kick` / `ban`. **Never ban by default.** If a kick/ban fails (permissions), the member is flagged instead. Flagged joins are posted to the modlog channel when one is set.
- **What it can't see (honest limits):** Discord does not expose whether an account's email/phone is verified, so verification status is never checked directly — account age, avatar, and join bursts are proxies. Scores are heuristics, not proof: a real new user can trip them, which is why flag-only is the default and every flag is reviewable. Join-burst/clustering signals are in-memory (last 10 minutes, per process) — a restart clears the window, and sharded bots only see joins on their own shards.
- **Commands (staff, ephemeral):** `/staff botflags [status]` (recent flags), `/staff botflag <user>` (full score breakdown), `/staff botflag-clear <user>` (marks reviewed, records who cleared it — the row is kept, not deleted), `/staff bottrack` (joins today/this week + raid-watch status).
- **Dashboard:** Staff → Bot Tracking — pick a server, see the raid-watch status, edit threshold/auto-action/suspect role, review the flagged-accounts table (Clear / Kick / Ban from the page), and see joins vs flagged per day for the last 7 days.

## Starboard

When a message collects enough reactions of the configured star emoji, it is posted to the starboard channel as an embed (author, content, jump link, star count, first image attachment). The count updates as stars arrive; if it drops below the threshold the starboard post is deleted (the DB row is kept, marked removed). Bot messages and messages already in the starboard channel are ignored.
- Tables: `starboard` (per guild); settings in `guild_premium_settings` (`starboard_channel_id`, `starboard_threshold` default 3, `starboard_emoji` default ⭐).
- Command: `/starboard setup <channel> [threshold] [emoji]` (admin). Dashboard Starboard tab: same settings. Needs the `GuildMessageReactions` intent + Message/Reaction partials (enabled in `index.js`) so reactions on older messages still count.

## Custom Commands

Per-server trigger words (`custom_commands` table): when a message starts with (or exactly equals) a registered trigger, the bot replies with the stored response and increments `use_count`.
- Guards: triggers are a single lowercase word; triggers matching a built-in slash command name are refused; `@everyone`/`@here` in responses are stripped so a custom command can never mass-ping.
- Commands (admin, ephemeral): `/custom add <trigger> <response>`, `/custom remove <trigger>`, `/custom list`. Dashboard Custom Commands tab: add/remove/list.

## Message Logging (modlog)

Deleted and edited messages are stored in MySQL (`message_logs`) and posted as embeds to the configured modlog channel (author, channel, content excerpt / old vs new with a jump link). Only logs when a modlog channel is set. Content that looks like a token or password is redacted before it is stored or posted.
- Command: `/mod modlog-setup [channel]` (admin — no channel = off). Dashboard Moderation tab: modlog channel setting.

## AFK

`/tools afk [reason]` marks you AFK (stored in `afk_users`); anyone who mentions you gets a small embed saying you're AFK since when and why. When you send any message, your AFK status clears and you get a one-time welcome-back note. The bot also tries to prefix your nickname with `[AFK]` (and revert it on return) when it has the Manage Nicknames permission — nickname failures never fail the command. `/tools afk-remove` clears it manually. Discord-only (no dashboard tab).

## Polls

`/tools poll <question> <option1> <option2> [option3..5] [duration]` posts a public poll embed with number-emoji reactions (1️⃣–5️⃣) and a live tally bar. One vote per user — reacting with a different number moves your vote, removing your reaction removes it. Counts live in MySQL (`polls`: options + votes as JSON) and the embed is re-rendered on every vote. `/tools poll-end <message_id>` (admin) ends a poll early, posts the winner, and removes the reactions. Duration accepts the same time formats as `/tools schedule` ("in 2h", "tomorrow 9am", "2026-11-14 15:00"); polls without a duration run until ended. Discord-only (no dashboard tab). Needs the `GuildMessageReactions` intent + partials (enabled in `index.js`).

## Auto-role + Sticky Roles

- **Auto-role:** `/tools autorole set <role>` gives every new member that role on join; `/tools autorole remove` turns it off; `/tools autorole view` shows the current settings. The bot refuses roles above its own highest role.
- **Sticky roles:** `/tools autorole sticky <enabled>` — when on, a leaving member's assignable roles are saved (`sticky_roles` table) and restored if they rejoin (only roles that still exist and the bot can assign).
- Settings live in `guild_premium_settings` (`autorole_id`, `sticky_roles_enabled`). Dashboard Roles tab: auto-role dropdown + sticky toggle.

## Scheduled Messages & Reminders

- **Scheduled messages:** `/tools schedule <channel> <time> <content> [title]` (admin) — posts the message (or an embed, when a title is given) at the time. `/tools schedule-list` (admin) shows pending items; `/tools schedule-cancel <id>` (admin) cancels one. Times: "in 2h" / "in 30m" / "in 3d", "tomorrow 9am", "2026-11-14 15:00", or a bare clock ("21:30" = today, or tomorrow if passed).
- **Reminders:** `/tools remindme <time> <text>` — the bot DMs you at the time; if your DMs are closed it posts in the channel instead.
- Everything is stored in MySQL (`scheduled_messages`, `reminders`) and sent by a 1-minute loop (`src/utils/scheduler.js`, started on ready), so scheduled items survive restarts. Dashboard Scheduled tab: pending list + cancel.

## FAQ Auto-Responder

When a chat message matches a trigger phrase, the bot replies in-channel with the stored answer (embed) — public by design, that's the point. `contains` fires when the phrase appears anywhere in the message (case-insensitive); `exact` only when the whole message equals the phrase. First match in creation order wins; only one FAQ reply per message.
- Order of checks: custom commands run first — a message that matched a custom command never also triggers an FAQ. Slash-command-looking messages, bots, and DMs are skipped, and FAQ replies never trigger other FAQ/custom responses (no loops).
- Guards: max 50 FAQ entries per guild, trigger max 100 chars, response max 2000 chars, `@everyone`/`@here` stripped from responses.
- Commands (admin, confirmations ephemeral): `/faq add <trigger> <response> [match_type]`, `/faq remove <trigger>`, `/faq list` (shows match type + use counts). Dashboard FAQ tab: add/remove/list with a match-type dropdown.
- Table: `faq_responses` in `sql/premium.sql` (see note below).

## Presence (bot status)

The bot's Discord status rotates through activity templates showing live stats — global for the bot, NOT per-server. Rotation runs on every shard (each shard sets its own presence from the same templates; guild/user counts are gathered across shards via `broadcastEval`/`fetchClientValues`).
- **Templates:** `config.json` `presence.activities` (default: `Watching {guilds} servers`, `Listening to /help`, `Playing with {users} users`, `Watching {commands} commands`). Each entry is a string (defaults to Watching) or a `{text, type}` object; type is one of Playing / Watching / Listening / Competing. Rotation interval: `presence.rotateSeconds` (default 60, minimum 10).
- **Placeholders** (filled live on every rotation): `{guilds}` (server count), `{users}` (total member count across guilds), `{commands}` (total slash commands), `{uptime}`, `{version}` (from `package.json` — currently v1.2.7).
- **Commands** (owner-only, ephemeral): `/owner presence set <text> [type]` (one-off override, holds until the next rotation or `/owner presence reset`), `/owner presence reset` (back to rotating templates), `/owner presence list` (templates with live-filled values + what it's showing now).
- **Dashboard Staff → Bot overview:** Presence section shows the current activity (written to the `presence_state` table on every rotation so the standalone dashboard can see it), a **Rotate now** button (sets a flag the bot picks up within a minute), and a template editor (one per line, `Type: text` or plain text) saved to `config.json` `presence.activities` via a staff-only API — the bot re-reads `config.json` from disk on every rotation tick, so edits apply without a restart. `/utility status` and `/utility botstats` also show the bot version (from `package.json`).

## Premium tables

The premium features above (economy, casino, inventory/crates/trading, starboard, custom commands, message logs, AFK, polls, auto-role/sticky roles, scheduled messages/reminders, FAQ) live in **`sql/premium.sql`** — a separate file from `sql/schema.sql` so premium additions merge cleanly. Bot tracking (`bot_flags`, `bot_join_stats`) lives in `sql/schema.sql` with the core tables. Run it alongside `schema.sql` on a fresh install:
```
mysql -u <user> -p <database> < sql/schema.sql
mysql -u <user> -p <database> < sql/premium.sql
```
Per-server premium settings (starboard, modlog, auto-role, economy tuning) live in `guild_premium_settings`, managed by `src/utils/premiumSettings.js` (60s cache, same pattern as `guildSettings.js`). The first-run setup wizard auto-runs both `schema.sql` and `premium.sql` when "auto-run schema" is on.

## Updating the changelog

Every feature or fix ships with a changelog entry — the dashboard `/version` page renders from `CHANGELOG.md`, so it stays in sync automatically:
- Add a new `## [x.y.z] - YYYY-MM-DD` entry at the **top** of `CHANGELOG.md` (above the previous release), with `### Added` / `### Changed` / `### Fixed` sections and one bullet per change.
- Bump `package.json` `version` to match the new entry — `/utility botstats`, `/utility status`, the presence `{version}` placeholder, and the `/version` page header all read it from `package.json`, so they update together.
- Never list a version in the changelog that isn't in `package.json`, and never show a version on the dashboard that isn't in the changelog.

**Versioning rule (standing): one feature = one patch release within the current minor (1.2.1, 1.2.2, 1.2.3…).** A new minor (1.3.0) is only for a major milestone or a breaking change — never a new minor per feature, and never one version for a whole batch. Each changelog entry lists only its own feature's changes. `package.json` always matches the latest changelog entry.

## Dashboard JavaScript

The dashboard is a JavaScript-driven web app, not just server-rendered pages (vanilla JS, no framework — `dashboard/public/app.js` + per-page modules in `dashboard/public/js/`). EJS still renders the initial HTML, and every form keeps its `method`/`action`, so with JS disabled the browser POSTs normally and the server redirects back with `?saved=1` (plain-POST fallback).
- **`app.js`** (loaded on every page): toast notifications (`Settings saved` / error toasts), `AceBot.postJSON` / `getJSON` / `del` fetch helpers, `formToJSON` (checkboxes → booleans, `levelRoles` JSON parsed with a clear error), interception of `form[action^="/api/"]` (save via fetch, toast, no reload), `refreshSection(selector)` (re-fetch the page HTML, swap one list container — no full reload), `removeRow`, `refreshEvery` (auto-refresh while the tab is visible).
- **`js/settings.js`**: per-server settings page — live previews (stream template, welcome/goodbye) update as you type; streamer add/edit/remove/refresh, application forms + review queue, suggestions filter + review, shop / custom commands / FAQ / scheduled lists save via fetch with toasts and refresh just their list; deletes confirm + remove the row from the DOM; the Commands tab loads via fetch and toggles apply immediately.
- **`js/staff.js`**: staff area — command/feature toggles apply immediately; staff add/remove, backup-now, presence rotate/templates, broadcast (with a live embed preview as you type); overview stats auto-refresh every 30s from `/api/staff/overview`; errors/backups/bot-flags lists have refresh buttons; bot-flag Clear/Kick/Ban act via fetch and refresh the flags list.
- **`js/setup.js`**: the wizard navigates client-side — submit a step (or click a sidebar step) and the next step's HTML is fetched and swapped in with `history.pushState`; test-connection buttons still hit the server via fetch; back/forward buttons work.
- **`js/docs.js`**: the `/docs` search box filters command rows, guide cards, and FAQ items client-side, no server round-trip.
- **JSON endpoints for live refresh** (all auth-checked): `GET /api/staff/overview`, `GET /api/staff/errors`, `GET /api/staff/backups`, `GET /api/staff/botflags`, `GET /api/guilds/:id/invites`, plus the existing per-guild list endpoints (`/streamers`, `/applications`, `/suggestions`, `/shop`, `/custom-commands`, `/faq`, `/scheduled`, `/commands`).

## API keys — where to get them

Plain JSON has no comments, so `config.json` and `config.example.json` carry a `_whereToGetKeys` object at the top, plus a `_getItHere` link next to each credential section.
- **Discord bot token, client ID, client secret** — https://discord.com/developers/applications (Discord Developer Portal: create an application; Bot tab for the token, OAuth2 tab for client ID + secret).
- **Twitch client ID + secret** — https://dev.twitch.tv/console (Twitch Developer Console: register an application).
- **YouTube Data API v3 key** — https://console.cloud.google.com/apis/library/youtube.googleapis.com (Google Cloud Console: enable the YouTube Data API v3, then create an API key under APIs & Services → Credentials).
- **Steam Web API key** — https://steamcommunity.com/dev/apikey (sign in and register for a key).
- Kick, Facebook, and TikTok have no API keys in this bot's config (Kick uses its public API; Facebook/TikTok are manual-only), so no links are listed for them.

## Tempban (v1.9.1)

`/mod tempban @user <duration> [reason] [delete_days]` temporarily bans a member — they are automatically unbanned when the duration ends. Durations look like `12h`, `7d`, `2w`, or `30d`. You cannot tempban the server owner, yourself, or anyone with a higher or equal top role than you. `/mod tempban-list` shows all active tempbans in the server with who banned them, the reason, and the expiry time, and `/mod tempban-cancel @user` (admin only) unbans someone early. Tempbans are recorded in the `temp_bans` table and checked every 5 minutes (plus once at startup, so bans that expired while the bot was down are caught); if the database is down when you run `/mod tempban`, the ban still happens but the expiry is not recorded, so that user will not be auto-unbanned.
- Dashboard Moderation tab: active tempbans list with a Cancel button per row.

## Purge (v1.9.2)

`/mod purge <amount> [user] [contains]` deletes recent messages in the current channel, optionally only from one user and/or only messages containing specific text (case-insensitive). It fetches the 100 most recent messages, skips pinned messages, and only bulk-deletes messages under 14 days old — older matches are reported as skipped, since Discord refuses to bulk-delete them. The reply reports how many messages were deleted, how many were skipped and why. Each purge is written to the `purge_logs` table for auditing. For deleting an unfiltered batch of recent messages, `/mod clear` still works as before.

## Economy lottery (v1.9.4)

Weekly lottery: `/economy lottery buy [n1 n2 n3]` buys one ticket per user per week (default 100 coins from the wallet — bank funds can't buy a ticket; pick 3 numbers 1–30 or get random ones), `/economy lottery status` shows the jackpot size, your tickets, and the time until the draw, `/economy lottery winners` shows the last draw. Draws run Sundays at 20:00 server time; the jackpot is 50% of that week's ticket sales, split equally between players matching all 3 numbers, with 100 coins each for 2 matches. Results post to the configured lottery channel and winners are DM'd. Weeks run Monday 00:00 UTC to Sunday. An unclaimed jackpot does not roll over. Ticket price and channel are per-server settings (`guild_settings.lottery_ticket_price`, `lottery_channel_id`).
- Tables: `lottery_tickets`, `lottery_draws` (in `sql/premium.sql`).
- Dashboard Economy tab: lottery status card (week, tickets sold, jackpot, next draw) + recent draws table.

## Server rules (v1.9.5)

One rules embed per server, stored in the `server_rules` table (`guild_id`, `title`, `content`, `channel_id`, `message_id`, `updated_at`). `/tools rules-setup <channel>` (admin) opens a modal for the title and rules text and posts the embed; re-running it edits the existing message instead of posting a duplicate. `/tools rules` (anyone) shows the current rules in an ephemeral embed. `/tools rules-edit` (admin) opens a modal prefilled with the current title and text and updates the posted message in place. If no rules are set, `/tools rules` and `/tools rules-edit` reply with an ephemeral error embed.
- Dashboard General tab: rules editor with title, rules text, channel picker, and live preview.

## Anti-nuke protection (v1.9.6)

Anti-nuke protection (`/staff antinuke-setup`, `/staff antinuke-status`): counts a member's destructive actions (channel/role deletes, channel-create bursts, bans, kicks) in a rolling 60 seconds and, at the guild threshold (default 5), kicks, bans, or strips their roles (lockdown). Never acts on the server owner or the bot; whitelisted roles are exempt; the owner is DM'd and an alert is posted to the log channel. **Honest limitation:** Discord's audit log is the only source for who performed an action, and it can lag a few seconds or be unavailable — so detection is best-effort and the bot can only act after the damage has started. It limits the damage from a compromised moderator account; it cannot prevent the first deletions. Keep the bot's role above the roles it may need to strip, and give it View Audit Log, Kick/Ban Members, and Manage Roles.
- Settings live in `guild_settings` (`antinuke_enabled`, `antinuke_action`, `antinuke_threshold`, `antinuke_log_channel_id`, `antinuke_whitelist_roles`); events are audit-logged to `antinuke_events`.
- Dashboard Staff → Anti-Nuke: pick a server, edit settings + whitelist, review the recent-events table.
