# Deploying on an Ubuntu server with Nginx

Run the bot on a server (not your PC) so it stays up 24/7, with the
dashboard served on your own domain over HTTPS. This guide assumes a
fresh Ubuntu 22.04 or 24.04 server you can SSH into.

**Placeholders used below — replace every one before running:**
- `YOUR-DOMAIN` — your domain, e.g. `bot.example.com` (the Nginx config
  in this repo uses `bot.example.com` as its placeholder — replace it
  everywhere it appears).
- `/home/ace/discord-bot` — where you clone the repo (change it if your
  username or path differs; the systemd units below must match).
- `ace` — the Linux user that runs the bot (use your own username).
- `YOUR_MYSQL_PASSWORD_HERE` — a password you make up for the bot's
  MySQL user. Never reuse a password from anywhere else.

## 0. What you need first

- A Discord application with a bot token, client ID, and client secret
  (Developer Portal → your application → Bot / OAuth2). You will paste
  these into the setup wizard in step 4 — have them ready.
- Your domain's DNS pointed at the server (`A` record for `YOUR-DOMAIN`
  → the server's public IP). HTTPS in step 6 will not work until DNS
  has propagated.
- SSH access to the server as a user with `sudo`.

## 1. Install Node.js 20 and build tools

The bot needs Node.js 18 or newer; Node 20 LTS is the safe pick.
(The welcome-image canvas feature also needs the native libraries in
the second command.)

```bash
sudo apt update && sudo apt install -y curl git build-essential python3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
node --version   # should print v20.x
```

## 2. Install MySQL and create the bot's database

```bash
sudo apt install -y mysql-server
sudo mysql
```

At the `mysql>` prompt, run (replace the password placeholder):

```sql
CREATE DATABASE discord_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'discord_bot'@'localhost' IDENTIFIED BY 'YOUR_MYSQL_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON discord_bot.* TO 'discord_bot'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 3. Clone the repo and install dependencies

```bash
git clone https://github.com/Acebennett22/discord-bot.git /home/ace/discord-bot
cd /home/ace/discord-bot
npm install
```

## 4. First-run setup wizard (through your domain)

Start the dashboard once by hand:

```bash
npm run dashboard
```

It prints a one-time setup link to the console and writes the token to
`setup-token.txt`. The printed link is `http://localhost:3010/setup?token=<token>` —
**through Nginx you open the same path on your domain instead:**

```
https://YOUR-DOMAIN/setup?token=<token>
```

(Do this after step 5 + 6 if you want HTTPS from the start, or open the
`localhost:3010` link over SSH port-forwarding first and add the domain
later — the wizard shows a warning banner over plain HTTP, so prefer
HTTPS. The token is single-use: presenting it starts your setup
session and invalidates it.)

Follow the 8 wizard steps (Discord token/client ID/secret/owner ID,
MySQL connection — use the database and password from step 2 — dashboard
port and session secret, streaming APIs, Steam API, backups, review).
On the Dashboard step, set the public URL to `https://YOUR-DOMAIN` so
OAuth redirects, invite links, and setup links use your domain. Saving
writes `config.json` (mode 0600) and disables the wizard.

If you prefer to configure by hand instead, see "Manual setup" in the
repo README (`cp config.example.json config.json` and fill it in).

## 5. Register commands and start the bot

```bash
npm run deploy   # registers all slash commands with Discord (global; can take ~1 hour to appear)
npm start        # sharded bot (production). Stop it with Ctrl+C for now — step 7 makes it permanent.
```

Check the bot is online in Discord, then stop it (`Ctrl+C`) before
setting up the services below.

## 6. Nginx — serve the dashboard on your domain

The Nginx config already lives in this repo at
`deploy/nginx/ace-bot.conf` — an example server block that proxies to
the dashboard on `127.0.0.1:3010`, with the `Host`, `X-Real-IP`,
`X-Forwarded-For`, and `X-Forwarded-Proto` headers, WebSocket Upgrade
headers, and `client_max_body_size 10m`. Full walkthrough in
`deploy/nginx/README.md`; the short version:

```bash
sudo apt install -y nginx
sudo cp deploy/nginx/ace-bot.conf /etc/nginx/sites-available/ace-bot
sudo ln -s /etc/nginx/sites-available/ace-bot /etc/nginx/sites-enabled/
# Replace every bot.example.com in that file with YOUR-DOMAIN:
sudo sed -i 's/bot\.example\.com/YOUR-DOMAIN/g' /etc/nginx/sites-available/ace-bot
sudo nginx -t && sudo systemctl reload nginx
```

## 7. HTTPS with Let's Encrypt (certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR-DOMAIN
```

Certbot fills in the `ssl_certificate` lines in the Nginx config and
sets up automatic renewal. Test it with `sudo nginx -t` and reload.

In the Discord Developer Portal → OAuth2 → Redirects, add
`https://YOUR-DOMAIN/callback` so dashboard login works.

## 8. systemd services — survive reboots

The bot (`npm start`) and the dashboard (`npm run dashboard`) are two
separate processes, so they get two services. Create both files,
replacing `/home/ace/discord-bot` and `ace` with your path and user:

**`/etc/systemd/system/discord-bot.service`** — the bot itself:

```ini
[Unit]
Description=Ace Discord Bot
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=ace
WorkingDirectory=/home/ace/discord-bot
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/discord-bot-dashboard.service`** — the dashboard:

```ini
[Unit]
Description=Ace Discord Bot Dashboard
After=network-online.target discord-bot.service
Wants=network-online.target

[Service]
Type=simple
User=ace
WorkingDirectory=/home/ace/discord-bot
ExecStart=/usr/bin/npm run dashboard
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then enable and start them:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot.service discord-bot-dashboard.service
sudo systemctl status discord-bot.service discord-bot-dashboard.service
```

Logs: `sudo journalctl -u discord-bot.service -f` (bot) and
`sudo journalctl -u discord-bot-dashboard.service -f` (dashboard).

## 9. Updating later

```bash
cd /home/ace/discord-bot
git pull
npm install
# If the update added database tables/columns (see CHANGELOG.md), apply them:
mysql -u discord_bot -p discord_bot < sql/schema.sql
# For existing installs, also run any ALTER TABLE lines noted in sql/schema.sql.
npm run deploy
sudo systemctl restart discord-bot.service discord-bot-dashboard.service
```

## Troubleshooting

- **Bot won't start / login failed:** the token in `config.json` is
  wrong or the bot wasn't invited — check `journalctl -u discord-bot.service`.
- **Dashboard shows the setup wizard again:** `setupComplete` got reset
  in `config.json`, or you're looking at a different install. Re-run the
  wizard or restore `config.json` from backup.
- **Dashboard login loops / cookies don't stick:** `dashboard.publicUrl`
  in `config.json` must match the domain you're actually opening, and
  Nginx must send `X-Forwarded-Proto` (the shipped config does).
- **Commands don't appear:** global registration can take up to an hour;
  `npm run deploy` must have finished without errors.
- **MySQL connection refused:** `sudo systemctl status mysql` — the bot
  keeps running without MySQL, but logging/stats/tickets/streams/
  giveaways/leveling are skipped until it connects.
