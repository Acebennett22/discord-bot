-- Premium-feature tables (economy, starboard, custom commands, message
-- logging, AFK, polls, auto-role/sticky roles, scheduled messages).
-- Run alongside sql/schema.sql on a fresh install:
--   mysql -u <user> -p <database> < sql/schema.sql
--   mysql -u <user> -p <database> < sql/premium.sql
-- The first-run setup wizard (dashboard, step 3) auto-runs both schema.sql
-- and premium.sql when "auto-run schema" is on (see src/dashboard.js).
-- All tables are per-server: every row carries a
-- guild_id, so no server can see or affect another server's data.

-- Per-guild premium settings (starboard, modlog, auto-role, economy
-- tuning). One row per guild; the bot falls back to the defaults below
-- (and config.json economy.*) when no row exists.
CREATE TABLE IF NOT EXISTS guild_premium_settings (
  guild_id VARCHAR(32) NOT NULL,
  starboard_channel_id VARCHAR(32) NULL,
  starboard_threshold INT UNSIGNED NOT NULL DEFAULT 3,
  starboard_emoji VARCHAR(32) NOT NULL DEFAULT '⭐',
  modlog_channel_id VARCHAR(32) NULL,
  autorole_id VARCHAR(32) NULL,
  sticky_roles_enabled TINYINT(1) NOT NULL DEFAULT 0,
  economy_starting_balance INT UNSIGNED NOT NULL DEFAULT 100,
  economy_daily_min INT UNSIGNED NOT NULL DEFAULT 100,
  economy_daily_max INT UNSIGNED NOT NULL DEFAULT 500,
  economy_work_min INT UNSIGNED NOT NULL DEFAULT 50,
  economy_work_max INT UNSIGNED NOT NULL DEFAULT 250,
  economy_currency_name VARCHAR(32) NOT NULL DEFAULT 'coins',
  economy_currency_emoji VARCHAR(32) NOT NULL DEFAULT '🪙',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Economy: one wallet+bank row per user per guild.
CREATE TABLE IF NOT EXISTS economy_users (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  balance INT NOT NULL DEFAULT 0,
  bank INT NOT NULL DEFAULT 0,
  last_daily TIMESTAMP NULL,
  last_work TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id),
  INDEX idx_economy_balance (guild_id, balance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Economy: audit trail of every gain/spend/transfer (daily, work, pay,
-- shop purchases, deposits, withdrawals).
CREATE TABLE IF NOT EXISTS economy_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  amount INT NOT NULL,
  type VARCHAR(32) NOT NULL,
  reason VARCHAR(256) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_economy_tx_user (guild_id, user_id),
  INDEX idx_economy_tx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Economy shop: buyable items per guild. type decides what buying does:
-- role = grants role_id; crate = goes to inventory, opened with /open-crate;
-- consumable = goes to inventory, used with /use; collectible = inventory only.
-- sell_price defaults to half of price when NULL (never above price).
-- crate_contents (type=crate only) is a JSON array of weighted rewards:
--   [{"kind":"coins","min":50,"max":150,"weight":60},
--    {"kind":"item","item_name":"Rare Crate","weight":10}]
-- where kind=item looks the item up by name in the same guild's shop.
CREATE TABLE IF NOT EXISTS shop_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  price INT UNSIGNED NOT NULL,
  role_id VARCHAR(32) NULL,
  emoji VARCHAR(16) NULL,
  type ENUM('role','crate','consumable','collectible') NOT NULL DEFAULT 'collectible',
  sell_price INT UNSIGNED NULL,
  crate_contents JSON NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_shop_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inventory: one row per (guild, user, item) with a quantity. Roles are
-- NOT stored here — buying a role item grants the Discord role directly.
CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory (guild_id, user_id, item_id),
  INDEX idx_inventory_user (guild_id, user_id),
  INDEX idx_inventory_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily deal: one discounted shop item per guild per day (25% off),
-- the same deal for everyone in the guild that day, rotating at midnight.
CREATE TABLE IF NOT EXISTS daily_deals (
  guild_id VARCHAR(32) NOT NULL,
  deal_date DATE NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  discount_percent INT UNSIGNED NOT NULL DEFAULT 25,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, deal_date),
  INDEX idx_deal_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player-to-player trades. Offers are JSON so a trade can carry coins
-- and/or items from each side, e.g. {"coins":100,"items":[{"item_id":5,"quantity":2}]}.
-- Status flow: pending -> accepted (partner) -> completed (proposer confirms),
-- or cancelled / expired (60s).
CREATE TABLE IF NOT EXISTS trades (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  proposer_id VARCHAR(32) NOT NULL,
  partner_id VARCHAR(32) NOT NULL,
  proposer_offer JSON NOT NULL,
  partner_offer JSON NOT NULL,
  status ENUM('pending','accepted','completed','cancelled','expired') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_trades_guild (guild_id),
  INDEX idx_trades_users (proposer_id, partner_id),
  INDEX idx_trades_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Starboard: one row per starred message per guild.
CREATE TABLE IF NOT EXISTS starboard (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  starboard_message_id VARCHAR(32) NULL,
  star_count INT UNSIGNED NOT NULL DEFAULT 0,
  removed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_starboard_message (guild_id, message_id),
  INDEX idx_starboard_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom commands: one trigger word per guild.
CREATE TABLE IF NOT EXISTS custom_commands (
  guild_id VARCHAR(32) NOT NULL,
  trigger_word VARCHAR(64) NOT NULL,
  response TEXT NOT NULL,
  created_by VARCHAR(32) NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, trigger_word)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message logs: deleted/edited messages, for the modlog channel.
-- Content is stored so the modlog embed can show it; messages whose
-- content looks like a token/password are redacted before insert.
CREATE TABLE IF NOT EXISTS message_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  content TEXT NULL,
  action ENUM('deleted','edited') NOT NULL,
  old_content TEXT NULL,
  new_content TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_message_logs_guild (guild_id),
  INDEX idx_message_logs_channel (guild_id, channel_id),
  INDEX idx_message_logs_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AFK: one row per AFK user per guild.
CREATE TABLE IF NOT EXISTS afk_users (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  reason VARCHAR(256) NULL,
  since TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Polls: question + options as JSON, votes as JSON {userId: optionIndex}.
CREATE TABLE IF NOT EXISTS polls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  channel_id VARCHAR(32) NOT NULL,
  question VARCHAR(256) NOT NULL,
  options JSON NOT NULL,
  votes JSON NOT NULL,
  final_counts JSON NULL,
  ends_at TIMESTAMP NULL,
  ended TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_polls_guild (guild_id),
  INDEX idx_polls_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sticky roles: roles a member had when they left, restored on rejoin.
CREATE TABLE IF NOT EXISTS sticky_roles (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  roles JSON NOT NULL,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduled messages: posted by the bot at send_at, then marked sent.
-- content is plain text; embed_json (optional) holds an embed object.
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  author_id VARCHAR(32) NOT NULL,
  content TEXT NULL,
  embed_json JSON NULL,
  send_at TIMESTAMP NOT NULL,
  sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scheduled_due (sent, send_at),
  INDEX idx_scheduled_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reminders: DM the user at remind_at (falls back to the channel if DMs
-- are closed), then marked sent.
CREATE TABLE IF NOT EXISTS reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  text VARCHAR(1000) NOT NULL,
  remind_at TIMESTAMP NOT NULL,
  sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_reminders_due (sent, remind_at),
  INDEX idx_reminders_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FAQ auto-responder: trigger phrase -> response, per guild.
-- match_type 'contains' fires when the phrase appears anywhere in a
-- message (case-insensitive); 'exact' fires only on a whole-message match.
CREATE TABLE IF NOT EXISTS faq_responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  trigger_phrase VARCHAR(100) NOT NULL,
  response TEXT NOT NULL,
  match_type ENUM('exact','contains') NOT NULL DEFAULT 'contains',
  created_by VARCHAR(32) NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_faq_trigger (guild_id, trigger_phrase),
  INDEX idx_faq_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Presence state: the bot's current activity (for the standalone dashboard
-- to display) + a "rotate now" request flag the bot checks each tick.
CREATE TABLE IF NOT EXISTS presence_state (
  id INT NOT NULL,
  current_text VARCHAR(128) NULL,
  current_type VARCHAR(32) NULL,
  rotate_requested_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.9.4 (2026-11-13): weekly economy lottery.
CREATE TABLE IF NOT EXISTS lottery_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  week_start DATE NOT NULL,
  numbers JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lottery_ticket_week (guild_id, user_id, week_start),
  INDEX idx_lottery_tickets_week (guild_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lottery_draws (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  week_start DATE NOT NULL,
  winning_numbers JSON NOT NULL,
  winner_id VARCHAR(32) NULL,
  prize INT NOT NULL DEFAULT 0,
  drawn_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lottery_draws_week (guild_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.8.1 (2026-11-13): poll results chart — final tallies stored so results
-- survive restarts. On an existing database run:
--   ALTER TABLE polls ADD COLUMN final_counts JSON NULL;
