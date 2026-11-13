# Ace's Discord Bot

A multi-file JavaScript Discord bot built with **discord.js v14** (CommonJS) — moderation, music, server status/monitoring, fun/games, tickets, streams, leveling, Steam, giveaways, reaction roles, game-server status, and a web dashboard, all in one command-handler project. Everything is stored in **MySQL** (with a JSON fallback for warns) and the bot works across **many servers, sharded**.

> **Embed standard:** EVERY slash-command reply is an embed. Use `src/utils/embeds.js` — `successEmbed(title, description)` (green), `errorEmbed(title, description)` (red), `infoEmbed(title, description, fields)` / `statsEmbed(...)` (brand color from `config.json` `embedColor`, timestamp + `Ace Bot • /help` footer on every embed). Do not reply with plain text as the main response. Role-mention pings (stream-live, giveaway winners) may still appear as message content *alongside* an embed, since pings don't work reliably inside embeds.

## Features

| Category | Commands |
| --- | --- |
| Moderation | `/kick`, `/ban`, `/timeout`, `/warn` (add/list, JSON-backed + DB mirror), `/clear`, `/unban`, `/setup` (per-server settings) |
| Music | `/play`, `/skip`, `/stop`, `/queue`, `/pause`, `/resume` — `@discordjs/voice` + `play-dl`, DJ-role enforcement |
| Status / monitoring | `/ping` (shard-aware, lists every shard), `/uptime`, `/serverinfo`, `/userinfo`, `/status`, `/botstats`, `/mystats`, `/shards`, `/topcommands`, `/topusers`, `/guildstats`, `/globalstats` (owner) |
| Fun & games | `/8ball`, `/coinflip`, `/dice`, `/rps`, `/trivia` (built-in bank, no external API) |
| Tickets | `/ticket-setup`, `/ticket-close`, `/ticket-add`, `/ticket-remove`, `/ticket-claim` — panel + modals + HTML transcripts |
| Server Stats | `/serverstats-setup`, `/serverstats-toggle` — live stat voice channels |
| Streams | `/stream-add`, `/stream-remove`, `/stream-list`, `/stream-announce` — Twitch/YouTube/Kick live alerts |
| Leveling | `/rank`, `/leaderboard`, `/setlevel` — XP per message, role rewards |
| Steam | `/steam`, `/linksteam` |
| Giveaways | `/giveaway` (start/end/reroll/list) — button entry, random winners |
| Reaction Roles | `/reactionroles-setup`, `/reactionroles-add`, `/reactionroles-remove`, `/reactionroles-list` — button toggles |
| Game Servers | `/serverstatus`, `/gameserver-add`, `/gameserver-remove`, `/gameserver-list` — pluggable providers |
| Owner | `/restart`, `/reload`, `/shutdown`, `/eval` (owner-only, `ownerId` in config) |
| Help | `/help` — grouped command list with a category select menu |

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
3. **Open the wizard:** on first run the dashboard prints a one-time setup link to the console and writes the token to `setup-token.txt` — open `http://localhost:3000/setup?token=<token>` (or `https://your-domain/setup?token=<token>` behind a reverse proxy). The token is single-use: presenting it starts your setup session and invalidates it.
4. **Follow the 8 steps:** Welcome → Discord (token/client ID/secret/owner ID, with a **Test connection** button — an invalid token can't be saved) → Database (MySQL connection test + optional auto-run of `sql/schema.sql`) → Dashboard (port, session secret with a generate button, redirect URI auto-filled) → Streaming APIs (optional) → Steam API (optional) → Backups & misc (backup time, 30-day retention, embed color, queue size, sharding) → Review & finish (secrets masked) → **Save** writes `config.json` (mode 0600, preserving fields the wizard didn't ask about) and sets `setupComplete: true`, disabling the wizard. Then run `npm run deploy`, `npm start`, `npm run dashboard` as shown on the finish screen.
5. **Re-running setup:** after first setup the wizard only opens for the bot owner (logged-in owner session). To re-run from scratch, set `setupComplete: false` in `config.json` and restart the dashboard for a fresh one-time token.

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
     "dashboard": { "clientSecret": "", "redirectUri": "http://localhost:3000/callback", "sessionSecret": "CHANGE_ME_TO_A_LONG_RANDOM_STRING", "port": 3000, "invitePermissions": 1099951041558 }
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
- Per-server settings (welcome/log channels, ticket category/role/log, warn threshold/action, DJ role, embed color, server-stats channels, level roles) live in MySQL `guild_settings`, edited with `/setup` or the dashboard. The bot caches them for 60s, so dashboard changes are picked up without a restart.
- **Sharding:** `npm start` runs `src/shardManager.js` (ShardingManager spawning `index.js` workers). `sharding.mode: "auto"` (default) lets Discord recommend the count — roughly **1 shard per 1,000 guilds** — so it scales with usage and you don't need to hand-tune it. Set `mode: "manual"` + `totalShards: N` only with a specific reason. `npm run start:unsharded` runs one process (fine for 1 server).
- Per-shard state is independent: music queues live in memory per shard, warns/stats/logs live in MySQL so cross-shard stats come from the DB. `/shards` is the detailed shard overview; `/ping` lists every shard's ping + guild count, with ▶ marking the shard that answered.

## MySQL — what is logged

Every slash command is logged to `command_logs` (success/failure) from `interactionCreate`, and guild/user counters update in `guild_stats` / `user_stats`. Music plays increment `songs_played`; joins increment `members_joined`. Warns are stored in the **JSON file first** (`src/data/warns.json`, the primary store so warns work with no DB) and mirrored to the `warns` table when MySQL is available. See `sql/schema.sql` for `command_logs`, `guild_stats`, `user_stats`, `warns`, `guild_settings`, `streamers`, `tickets`, `user_levels`, `user_links`, `giveaways`, `giveaway_entries`, `reaction_roles`, `game_servers`, `game_server_status`.

## Music

Join voice, then `/play <song name or YouTube URL>`. Uses `play-dl` (no API key). Queue capped by `music.maxQueueSize` (default 25). If a DJ role is set (`/setup` or dashboard → Music), only that role + admins can use music commands. YouTube availability can vary — failed tracks are skipped with an embed. The queue manager is `src/utils/musicQueue.js` (the one place to swap the stream source, e.g. to yt-dlp).

## Tickets (Ticket Tool-style)

1. Run `/setup` (admin): set ticket category, support role, ticket log channel.
2. Run `/ticket-setup` in the channel where the panel should live.
3. A user clicks **Create Ticket** → modal asks for a subject → a private channel `ticket-<username>-<number>` is created (creator + support role + admins only) with Close / Claim / Add User buttons.
4. **Close** locks the channel, asks for a reason, generates an **HTML transcript** (`transcripts/`, messages with author/avatar/timestamp/content/attachments), sends it to the ticket log channel + DMs it to the creator, and **deletes the channel after 60 seconds** unless reopened from the log channel's **Reopen** button.
5. Slash equivalents: `/ticket-close`, `/ticket-add`, `/ticket-remove`, `/ticket-claim` — all permission-checked (creator, support role, or admin).

## Server Stats (ServerStats-style)

`/serverstats-setup` (admin) creates a **📊 Server Stats** category with display-only voice channels (Connect denied) like `👥 Members: 1,234`, `🟢 Online: 567`, `🤖 Bots: 12`, `🏆 Boosts: 8`. `/serverstats-toggle` enables/disables individual stats (members, online, bots, boosts, channels, roles). Channels refresh every `serverStats.updateIntervalMinutes` (default 10), on joins/leaves, and on presence changes (debounced); renames only happen when the value actually changed. Channel IDs are stored in `guild_settings`, so they survive restarts and work per-shard (only the owning shard updates them). **Online needs the Guild Presences intent** (enabled in `index.js` + the Developer Portal).

## Streams

`/stream-add` (admin): platform (`youtube`, `twitch`, `kick`, `facebook`, `tiktok`) + channel + notify channel + optional ping role. Checker runs every `streams.checkIntervalMinutes` (default 5) and posts a rich embed (title, game, thumbnail, viewers, link) **only on an offline → live transition** — never repeats. Going offline just updates the DB (no spam, unless `announceOfflineMessage` is on).
- **Twitch:** Helix API — get a client ID + secret at https://dev.twitch.tv (client-credentials flow, no user login needed). Fill in `streams.twitch`.
- **YouTube:** Data API v3 key from Google Cloud Console → `streams.youtube.apiKey`. Use the channel **ID** (UC…), not a handle.
- **Kick:** public API (`kick.com/api/v2/channels/<name>`) — no key needed. Note the endpoint may change; check Kick's docs if it breaks.
- **Facebook Live / TikTok:** honestly, **no simple public live-status API exists** (TikTok's LIVE API is partner-only). They are stored but never auto-checked — use `/stream-announce` (platform + URL + optional title) to announce them manually.
- Missing credentials = that platform is skipped with a startup warning; the others keep checking.
- **Dashboard:** the Streams tab manages watchers in the GUI — list (live dot, platform, notify channel, ping role, live channel), add form, edit notify/ping/live channel per streamer, and a **Refresh** button that re-checks that streamer now. Same `streamers` table as Discord, so both stay in sync.
- **Live channel name:** `/stream-add` (and the dashboard) take an optional `live_channel` — a voice or text channel whose **name** updates on transitions. Live: renamed to the template (default `🔴 LIVE: {name}`); offline: restored to its original name (stored in `streamers.live_channel_original_name` when first renamed — never guessed). Only one streamer per live channel (both Discord and dashboard refuse a clash). Renames happen only on state changes, never every check; Discord allows ~2 renames per 10 min per channel, so a failed rename is logged and retried on the next check instead of crashing.
- **Per-server template:** the template is stored in the **database** (`guild_settings.live_channel_name_template`) — set it on the dashboard Streams tab (with live preview) or with `/stream-template view|set|reset` (admin). Placeholders: `{name}` (required), `{game}`, `{title}`; max 100 chars, one line. `config.json` `streams.liveChannelNameTemplate` is only the global fallback for servers that never set their own. Migration for existing installs: `ALTER TABLE guild_settings ADD COLUMN live_channel_name_template VARCHAR(100) NULL; ALTER TABLE streamers ADD COLUMN live_channel_id VARCHAR(32) NULL, ADD COLUMN live_channel_original_name VARCHAR(100) NULL;`

## Leveling / XP

Members earn **15–25 XP per message** with a **60s cooldown** (configurable under `leveling`). Level curve: XP needed for level N = **100 × N^1.5** (level 1 = 100 XP, level 5 ≈ 1,118 XP total). Level-up messages post in-channel (toggleable per guild, `levelUpMessages` in `guild_settings`). Stored in MySQL `user_levels`. Commands: `/rank` (level, XP, progress bar, server rank), `/leaderboard` (top 10), `/setlevel` (admin). **Role rewards:** `guild_settings.level_roles` JSON maps level → role ID (dashboard → Leveling) — granted automatically on level-up.

## Steam

`/linksteam <Steam ID / vanity / profile URL>` stores your SteamID in `user_links`; `/steam [user] [steam]` shows name, avatar, online status, currently-playing game, and profile link. Needs `steam.apiKey` — get one free at https://steamcommunity.com/dev/apikey. Without a key, the commands reply that Steam isn't configured.

## Giveaways

`/giveaway start <prize> <duration 10m/1h/1d> [winners] [required role] [channel]` posts an embed with a **🎉 Enter** button (one entry per user, stored in `giveaway_entries`). A 30-second timer ends expired giveaways, picks random winner(s), announces them in the channel, and DMs winners. `/giveaway end <id>` ends early, `/giveaway reroll <id>` picks new winner(s), `/giveaway list` shows active giveaways.

## Reaction Roles

`/reactionroles-setup` (admin) posts a message with emoji **buttons** mapped to roles; clicking toggles the role. `/reactionroles-add` / `-remove` / `-list` manage pairs on an existing message. Mappings live in MySQL `reaction_roles`. Button-based only (no classic reactions) — reliable and needs no extra intent.

## Game Server Status (pluggable providers)

`src/utils/gameServers.js` is a **provider registry**: each provider is `{ id, name, query(host, port) }`. Shipped providers:
- `minecraft` — Java server-list ping (players, version, MOTD).
- `source` — A2S query, covers **Rust, CS2, TF2, Garry's Mod, ARK, Valheim**, etc.
- `http` — generic JSON endpoint (`extra.endpoint` + JSON paths for players/maxPlayers/online).
- `manual` — no query protocol; status is informational only, never faked.

**Adding a new game without code:** pick an existing provider — either in `config.json` `gameServers.custom` (`[{ id, name, provider, host, port }]`) or per-server with `/gameserver-add` (admin, stored in the `game_servers` DB table). **Adding a new provider:** one function + one registry entry in `src/utils/gameServers.js` (documented in the file header).
**The Isle limitation:** The Isle Evrima has **no public query protocol**, so it is `manual` status only — the bot will not claim it is online/offline. It is pre-configured as an example in `config.example.json` with placeholder values (not a real IP).
Commands: `/serverstatus [game]` (live embed, one game or all), `/gameserver-add`, `/gameserver-remove`, `/gameserver-list`. A checker runs every `gameServers.checkIntervalMinutes` (default 5), stores history in `game_server_status`, and posts online/offline transitions to the per-server notify channel if set. Dashboard → Game Servers lists tracked servers per guild.

## Owner commands

Checked against `ownerId` in `config.json` (anyone else gets an ephemeral owner-only embed; the owner ID is never leaked). `/restart` — under the ShardingManager it respawns the current shard; unsharded it destroys the client and exits so a **process manager** (pm2/systemd/Docker) can restart it (without one, start it again manually). `/reload <command>` hot-reloads one command file (slash *definitions* still need `npm run deploy`). `/shutdown` — graceful shutdown (closes DB pool, exits 0). `/eval <code>` — evaluates JS, output truncated to 1900 chars in a code block. **Security warning: /eval can run anything — owner-only for a reason. Never set ownerId to anyone else.**

## Dashboard (Dyno-style web GUI)

`npm run dashboard` → http://localhost:3000. **Auth:** Discord OAuth2 (same app as the bot). Log in, and the dashboard fetches your guilds — it shows **only guilds where you have Manage Guild AND the bot is a member**. No login = no access.
**Setup:** in the Developer Portal → OAuth2, add redirect URI `http://localhost:3000/callback` (or your `dashboard.redirectUri`), copy the **Client Secret** → `config.json` `dashboard.clientSecret`, and set a long random `dashboard.sessionSecret`. Fill `dashboard.port` (default 3000).
**Pages:** Home / server picker (grid with icons) → per-server settings, one page per module: General (welcome/log channels, embed color), Moderation (warn threshold + auto-action, log channel), Tickets (category, support role, log channel, recent tickets), Server Stats, Streams (list/add/remove), Music (DJ role), Leveling (level-up messages, role rewards), Reaction Roles, Game Servers. **Add to Server** button is in the header on every page and on the home page — it opens Discord's OAuth2 invite flow in a new tab, built from `config.json` `clientId` (never hardcoded) with `dashboard.invitePermissions`.
**API:** `GET/POST /api/guilds/:id/settings`, `/api/guilds/:id/streamers`, `/api/guilds/:id/tickets` — all auth-checked per guild, inputs validated server-side (channels/roles must actually exist in that guild). Security: express-session + Helmet + rate limiting; the bot token and DB password are **never** in frontend code or API responses. The dashboard reads/writes the same MySQL tables as the bot, and the bot picks up changes within 60s (settings cache TTL).

## Invite link & permissions

The invite URL is `https://discord.com/oauth2/authorize?client_id=<clientId>&permissions=1099951041558&scope=bot%20applications.commands`, built from config (`dashboard.invitePermissions`, default **1099951041558**). Permissions included and why:
- Manage Channels (16) — ticket + stat channels; Manage Roles (268435456) — leveling/reaction-role grants; Kick (2), Ban (4), Moderate Members/timeout (1099511627776) — moderation; Manage Messages (8192) — /clear; View Channels (1024), Send Messages (2048), Embed Links (16384), Attach Files (32768) — reading/sending embeds + transcripts; Connect (1048576), Speak (2097152), Use Voice Activity (33554432) — music voice; Manage Nicknames (134217728) — nickname moderation. Change the integer in `config.json` `dashboard.invitePermissions` without editing code.

## /ping (shard-aware)

`/ping` shows round-trip + API heartbeat for **this shard**, and lists **every shard** by ID with its own ping and guild count, one line per shard (e.g. `▶ Shard 0 — 42ms — 128 guilds`), with ▶/bold marking the shard that answered. Unsharded runs say so clearly. `/shards` is the detailed shard overview (count, per-shard guilds + latency).

## Nginx deployment (reverse proxy)

Serve the dashboard on a public domain over HTTPS with Nginx — this is also how the setup wizard is reached through a domain. Full walkthrough + config live in `deploy/nginx/` (`ace-bot.conf` + `README.md`).
- **Config:** copy `deploy/nginx/ace-bot.conf` to `/etc/nginx/sites-available/ace-bot`, symlink it into `sites-enabled`, replace `bot.example.com` with your domain, `sudo nginx -t && sudo systemctl reload nginx`. The server block listens on 80 (redirects to HTTPS) and 443 with `ssl_certificate` placeholders, proxies `/` to `http://127.0.0.1:3000` with `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers, `proxy_http_version 1.1` + WebSocket Upgrade headers, and `client_max_body_size 10m`.
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
- **Feature management:** whole-module toggles (`feature_toggles`): music, tickets, leveling, giveaways, streams, game servers, server stats, reaction roles, applications, invites — global and per-guild. Enforced in command handlers and background jobs (music disabled = `/play` refuses; streams disabled = the checker skips that server).
- **Broadcast (owner only):** send an embed announcement to one server + channel, or to a channel *name* in every server. Requires a confirm checkbox, sends are spaced out for rate limits, and every broadcast is logged to `broadcasts` + `staff_audit`.
- **Errors page:** see the Error Logging section below. **Backups page:** see Backups below.

## Applications (Appy-style)

`/application-create` (admin) creates a form: pick the review channel + optional role-to-grant, then a modal asks for name, description, and up to 5 questions (one per line). `/application-list` (staff), `/application-open` / `/application-close` (admin, by form ID). Members run `/apply` — a select menu of open forms, then a modal with the form's questions. On submit the application is saved as `pending` and an embed with the answers + **Accept / Deny** buttons is posted to the review channel. Accept grants the configured role, DMs the applicant, and marks it accepted; Deny asks for a reason via modal and DMs the denial + reason. Slash equivalents: `/application-accept <id> [note]`, `/application-deny <id> [reason]`, `/application-view <id>` (staff), `/application-status` (your own). Reviewers = admins or the `applicationReviewerRoleId` role (set in the dashboard → Applications, stored in `guild_settings`). Dashboard Applications tab: list/create/open/close forms and a review queue with Accept/Deny buttons (role grant + DM done via Discord REST). Tables: `application_forms`, `applications`.

## Invite tracker

On startup and on InviteCreate/InviteDelete, the bot caches each guild's invites (code → uses, inviter). On `guildMemberAdd` it compares cached uses to the live list — the invite whose use count went up is the inviter — and records it in `invite_uses`, updating the inviter's aggregates in `user_invites` (total / valid / leaves / fake). On `guildMemberRemove` it marks `left_at` and decrements valid invites. An invite log message goes to `guild_settings.inviteLogChannelId` (or the welcome channel), saying who invited them and the inviter's total.
- **Fake invites:** joins from accounts younger than the threshold are flagged fake (`invite_uses.is_fake`) and don't count toward valid invites. Threshold: `config.json` `invites.minAccountAgeDays` (default **7**), overridable per server on the dashboard Invites tab (`invite_min_account_age_days`).
- **Vanity URL:** if the guild has a vanity URL and its use count rose, the join is counted as vanity (no specific inviter) and shown in stats.
- **Requirements:** the bot needs **Manage Server** permission to fetch invites — without it, joins show as "unknown invite".
- Commands: `/invites [user]` (total/valid/leaves/fake), `/inviteleaderboard` (top 10 by valid invites), `/invite-info <code>` (who made it, uses, channel, max uses), `/invite-reset [user] [confirm:true]` (admin, confirm required). Dashboard Invites tab: leaderboard, per-user stats table, log channel + fake-threshold settings.

## Error logging (staff)

`src/utils/errorLogger.js` is the single place errors go — every part of the bot uses it instead of `console.error` alone. Each entry: timestamp, level (`error`/`warn`/`info`), shard id, guild id, command/event name, user id, message, stack trace, context object.
- **Storage — every error, no exceptions:** each entry is written to the MySQL `error_logs` table (no sampling, no dropping — error and warn both go in) **and** to a local rotating log file `logs/bot-errors.log` (one JSON line per entry, so errors survive a DB outage). If the DB is down when an error occurs, the entry is queued in memory and **backfilled** into `error_logs` once the DB reconnects (retry every 60s + after each successful insert).
- **Redaction:** any field whose name matches token/password/secret/key/api-key/auth is replaced with `[REDACTED]` before storage or file write. Message content is never logged wholesale.
- **Coverage:** `unhandledRejection` + `uncaughtException` handlers in `index.js` and `shardManager.js`; shard disconnect/death/error events; the `interactionCreate` try/catch (command errors keep the user-facing "something went wrong" embed); music player errors, stream-check failures, ticket transcript failures, dashboard 500s (error middleware).
- **Staff visibility:** `/errors [level] [command]` (owner/staff — last 10, with time/command/message), `/error <id>` (full details incl. stack, truncated to fit), `/errors-clear [confirm:true] [scope: resolved|old|everything]` (owner only). Dashboard Staff → Errors: filterable table (level/command/shard), click for the full stack trace, **Mark resolved** action (`resolved` + `resolved_by` columns), and an error-count badge (last 24h) on the staff overview.

## Database backups (daily)

`scripts/backup-db.js` dumps the full database with `mysqldump` (credentials from `config.json`, passed via the `MYSQL_PWD` env var — never in argv or logs) to `backups/YYYY-MM-DD-HHmm.sql.gz`, and logs each run to `backup_logs` (filename, size, status, error). On failure it also logs to the error logger.
- **Schedule:** the bot runs it daily at `config.json` `backups.time` (default **03:00**) via `node-cron` (in-process, works out of the box). OS-cron alternative: `0 3 * * * cd /path/to/bot && npm run backup`.
- **Retention: 30 days** (`backups.retentionDays`, default 30) — after a successful new backup, files older than 30 days are deleted automatically.
- **Manual:** `/backup` (owner only) runs one now and replies with filename/size/status; the dashboard Staff → Backups page has a **Backup now** button, a file list with staff-only download links, and the run log.
- **Restore:** `node scripts/restore-db.js <file.sql.gz> --confirm` (interactive confirm if `--confirm` is omitted — restore overwrites the database), or manually: `gunzip -c backups/<file> | mysql -u <user> -p <database>`.
- **Safety:** `backups/` and `logs/` are in `.gitignore` and are never uploaded to Google Drive; backup filenames and logs never contain credentials.

## API keys — where to get them

Plain JSON has no comments, so `config.json` and `config.example.json` carry a `_whereToGetKeys` object at the top, plus a `_getItHere` link next to each credential section.
- **Discord bot token, client ID, client secret** — https://discord.com/developers/applications (Discord Developer Portal: create an application; Bot tab for the token, OAuth2 tab for client ID + secret).
- **Twitch client ID + secret** — https://dev.twitch.tv/console (Twitch Developer Console: register an application).
- **YouTube Data API v3 key** — https://console.cloud.google.com/apis/library/youtube.googleapis.com (Google Cloud Console: enable the YouTube Data API v3, then create an API key under APIs & Services → Credentials).
- **Steam Web API key** — https://steamcommunity.com/dev/apikey (sign in and register for a key).
- Kick, Facebook, and TikTok have no API keys in this bot's config (Kick uses its public API; Facebook/TikTok are manual-only), so no links are listed for them.
