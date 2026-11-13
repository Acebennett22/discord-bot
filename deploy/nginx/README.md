# Nginx reverse proxy for the Ace Bot dashboard

Serves the dashboard (localhost:3010) on a public domain over HTTPS, e.g. `https://bot.example.com`. This is also how the first-run setup wizard is reached through a domain.

## Steps

1. **Install Nginx**
   ```bash
   sudo apt update && sudo apt install nginx
   ```
2. **Copy the config**
   ```bash
   sudo cp deploy/nginx/ace-bot.conf /etc/nginx/sites-available/ace-bot
   sudo ln -s /etc/nginx/sites-available/ace-bot /etc/nginx/sites-enabled/
   ```
3. **Edit it** — replace every `bot.example.com` with your domain, and point `ssl_certificate` / `ssl_certificate_key` at your cert files (or leave them for Certbot in step 5).
4. **Point the dashboard at the domain** — in `config.json`:
   ```json
   "dashboard": { "publicUrl": "https://bot.example.com", "setupViaDomain": true }
   ```
   The OAuth redirect URI becomes `https://bot.example.com/callback` — add that exact URI in the Discord Developer Portal → OAuth2 → Redirects.
5. **Free TLS certificate (Let's Encrypt)**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d bot.example.com
   ```
   Certbot edits the Nginx config to add the certificate lines and renews it automatically.
6. **Test + reload**
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
7. **First-run setup through the domain** — start the dashboard (`npm run dashboard`). It prints a one-time setup token to the console and writes it to `setup-token.txt`. Open `https://bot.example.com/setup?token=<token>` (single-use; after setup completes the wizard is disabled via `setupComplete` in config.json). The wizard shows a warning banner if you ever reach it over plain HTTP.

## How the dashboard behaves behind the proxy

- `app.set('trust proxy', 1)` — Express trusts `X-Forwarded-Proto`/`X-Forwarded-For` from Nginx only, so `req.protocol` is `https` and secure session cookies work.
- Rate limiting (including the 10-attempts-per-15-min limit on `/setup`) keys off the real client IP from `X-Forwarded-For`.
- OAuth redirect URI, invite links, and setup links use `dashboard.publicUrl` when set, falling back to `http://localhost:<port>`.
