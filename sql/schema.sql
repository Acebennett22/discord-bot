-- Discord Bot — MySQL schema
-- Run once:  mysql -u <user> -p discord_bot < sql/schema.sql
-- (Create the database first: CREATE DATABASE discord_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;)

CREATE TABLE IF NOT EXISTS command_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NULL,
  user_id VARCHAR(32) NOT NULL,
  username VARCHAR(128) NULL,
  command_name VARCHAR(64) NOT NULL,
  channel_id VARCHAR(32) NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_command_logs_guild (guild_id),
  INDEX idx_command_logs_command (command_name),
  INDEX idx_command_logs_user (user_id),
  INDEX idx_command_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_stats (
  guild_id VARCHAR(32) NOT NULL,
  commands_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
  songs_played BIGINT UNSIGNED NOT NULL DEFAULT 0,
  members_joined BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_stats (
  user_id VARCHAR(32) NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  commands_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
  warns INT UNSIGNED NOT NULL DEFAULT 0,
  last_seen TIMESTAMP NULL,
  PRIMARY KEY (user_id, guild_id),
  INDEX idx_user_stats_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  moderator_id VARCHAR(32) NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_warns_guild_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id VARCHAR(32) NOT NULL,
  welcome_channel_id VARCHAR(32) NULL,
  welcome_message TEXT NULL,
  welcome_enabled TINYINT(1) NOT NULL DEFAULT 1,
  goodbye_channel_id VARCHAR(32) NULL,
  goodbye_message TEXT NULL,
  goodbye_enabled TINYINT(1) NOT NULL DEFAULT 1,
  suggestion_channel_id VARCHAR(32) NULL,
  log_channel_id VARCHAR(32) NULL,
  ticket_category_id VARCHAR(32) NULL,
  ticket_log_channel_id VARCHAR(32) NULL,
  ticket_support_role_id VARCHAR(32) NULL,
  warn_threshold INT NULL,
  warn_action VARCHAR(16) NULL,
  dj_role_id VARCHAR(32) NULL,
  embed_color VARCHAR(16) NULL,
  ticket_panel_channel_id VARCHAR(32) NULL,
  level_up_messages TINYINT(1) NOT NULL DEFAULT 1,
  level_roles JSON NULL,
  server_stats_enabled TINYINT(1) NOT NULL DEFAULT 0,
  server_stats_channels JSON NULL,
  live_channel_name_template VARCHAR(100) NULL,
  application_reviewer_role_id VARCHAR(32) NULL,
  invite_log_channel_id VARCHAR(32) NULL,
  invite_min_account_age_days INT NULL,
  bot_threshold INT NULL,
  bot_auto_action ENUM('flag','kick','ban') NOT NULL DEFAULT 'flag',
  bot_suspect_role_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  user_id VARCHAR(32) NOT NULL,
  claimed_by VARCHAR(32) NULL,
  subject VARCHAR(512) NULL,
  status ENUM('open','claimed','closed') NOT NULL DEFAULT 'open',
  transcript_path VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_tickets_guild (guild_id),
  INDEX idx_tickets_channel (channel_id),
  INDEX idx_tickets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS streamers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  platform ENUM('youtube','twitch','kick','facebook','tiktok') NOT NULL,
  channel_id_or_name VARCHAR(128) NOT NULL,
  channel_url VARCHAR(512) NULL,
  notify_channel_id VARCHAR(32) NOT NULL,
  ping_role_id VARCHAR(32) NULL,
  live_channel_id VARCHAR(32) NULL,
  live_channel_original_name VARCHAR(100) NULL,
  last_live_id VARCHAR(128) NULL,
  is_live TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_streamer (guild_id, platform, channel_id_or_name),
  INDEX idx_streamers_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_levels (
  user_id VARCHAR(32) NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
  level INT UNSIGNED NOT NULL DEFAULT 0,
  last_xp_at TIMESTAMP NULL,
  PRIMARY KEY (user_id, guild_id),
  INDEX idx_levels_guild_xp (guild_id, xp DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_links (
  user_id VARCHAR(32) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, platform),
  INDEX idx_links_platform (platform, external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS giveaways (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  prize VARCHAR(512) NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  winners_count INT UNSIGNED NOT NULL DEFAULT 1,
  required_role_id VARCHAR(32) NULL,
  status ENUM('active','ended','cancelled') NOT NULL DEFAULT 'active',
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_giveaways_guild (guild_id),
  INDEX idx_giveaways_ends (ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  entered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (giveaway_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reaction_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  emoji VARCHAR(64) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reaction_role (guild_id, message_id, emoji)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_servers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NULL,
  name VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT UNSIGNED NULL,
  extra JSON NULL,
  notify_channel_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_game_servers_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_server_status (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  server_id BIGINT UNSIGNED NOT NULL,
  online TINYINT(1) NULL,
  players INT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_gs_status_server (server_id, checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_users (
  user_id VARCHAR(32) NOT NULL,
  added_by VARCHAR(32) NULL,
  role ENUM('owner','admin','staff') NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_id VARCHAR(32) NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_staff_audit_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- guild_id '' = global toggle. Global off disables everywhere; guild off disables in that guild.
CREATE TABLE IF NOT EXISTS command_toggles (
  command_name VARCHAR(64) NOT NULL,
  guild_id VARCHAR(32) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(32) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (command_name, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_toggles (
  feature VARCHAR(64) NOT NULL,
  guild_id VARCHAR(32) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(32) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (feature, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id VARCHAR(32) NOT NULL,
  guild_id VARCHAR(32) NULL,
  channel_id VARCHAR(32) NULL,
  channel_name VARCHAR(128) NULL,
  title VARCHAR(256) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_forms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  questions JSON NOT NULL,
  role_to_grant VARCHAR(32) NULL,
  review_channel_id VARCHAR(32) NOT NULL,
  created_by VARCHAR(32) NULL,
  is_open TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_app_forms_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  answers JSON NOT NULL,
  status ENUM('pending','accepted','denied') NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(32) NULL,
  review_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_apps_form (form_id),
  INDEX idx_apps_guild_user (guild_id, user_id),
  INDEX idx_apps_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  code VARCHAR(32) NOT NULL,
  inviter_id VARCHAR(32) NULL,
  channel_id VARCHAR(32) NULL,
  uses INT UNSIGNED NOT NULL DEFAULT 0,
  max_uses INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invite_code (guild_id, code),
  INDEX idx_invites_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invite_uses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  invite_code VARCHAR(32) NOT NULL,
  inviter_id VARCHAR(32) NULL,
  invitee_id VARCHAR(32) NOT NULL,
  is_fake TINYINT(1) NOT NULL DEFAULT 0,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_invite_uses_guild_inviter (guild_id, inviter_id),
  INDEX idx_invite_uses_invitee (guild_id, invitee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_invites (
  user_id VARCHAR(32) NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  total_invites INT UNSIGNED NOT NULL DEFAULT 0,
  valid_invites INT UNSIGNED NOT NULL DEFAULT 0,
  leaves INT UNSIGNED NOT NULL DEFAULT 0,
  fake_invites INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS error_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  level ENUM('error','warn','info') NOT NULL DEFAULT 'error',
  shard_id INT NULL,
  guild_id VARCHAR(32) NULL,
  command_name VARCHAR(128) NULL,
  user_id VARCHAR(32) NULL,
  message TEXT NOT NULL,
  stack TEXT NULL,
  context JSON NULL,
  resolved TINYINT(1) NOT NULL DEFAULT 0,
  resolved_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_error_logs_level (level),
  INDEX idx_error_logs_command (command_name),
  INDEX idx_error_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename VARCHAR(256) NOT NULL,
  size_bytes BIGINT UNSIGNED NULL,
  status ENUM('success','failed') NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_backup_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Welcome/goodbye + suggestions live in guild_settings (see columns above).
-- Automod settings, one row per guild.
CREATE TABLE IF NOT EXISTS automod_settings (
  guild_id VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  spam_max_messages INT UNSIGNED NOT NULL DEFAULT 5,
  spam_window_seconds INT UNSIGNED NOT NULL DEFAULT 5,
  spam_action ENUM('delete','warn','timeout','delete_warn','delete_timeout') NOT NULL DEFAULT 'delete_warn',
  spam_timeout_minutes INT UNSIGNED NOT NULL DEFAULT 10,
  banned_words JSON NULL,
  block_links TINYINT(1) NOT NULL DEFAULT 0,
  block_invites TINYINT(1) NOT NULL DEFAULT 1,
  exempt_roles JSON NULL,
  exempt_channels JSON NULL,
  log_channel_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automod_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  action VARCHAR(32) NOT NULL,
  reason VARCHAR(128) NOT NULL,
  message_excerpt VARCHAR(512) NULL,
  channel_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_automod_actions_guild (guild_id),
  INDEX idx_automod_actions_user (guild_id, user_id),
  INDEX idx_automod_actions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suggestions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  suggestion_channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  title VARCHAR(256) NOT NULL,
  text TEXT NOT NULL,
  status ENUM('pending','approved','denied','implemented') NOT NULL DEFAULT 'pending',
  votes_up INT UNSIGNED NOT NULL DEFAULT 0,
  votes_down INT UNSIGNED NOT NULL DEFAULT 0,
  reviewed_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_suggestions_guild (guild_id),
  INDEX idx_suggestions_guild_user (guild_id, user_id),
  INDEX idx_suggestions_status (guild_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  vote ENUM('up','down') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (suggestion_id, user_id),
  INDEX idx_suggestion_votes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration note for existing installs: the guild_settings columns added for
-- welcome/goodbye/suggestions are NOT created by CREATE TABLE IF NOT EXISTS
-- on a table that already exists. Run once:
--   ALTER TABLE guild_settings
--     ADD COLUMN welcome_message TEXT NULL,
--     ADD COLUMN welcome_enabled TINYINT(1) NOT NULL DEFAULT 1,
--     ADD COLUMN goodbye_channel_id VARCHAR(32) NULL,
--     ADD COLUMN goodbye_message TEXT NULL,
--     ADD COLUMN goodbye_enabled TINYINT(1) NOT NULL DEFAULT 1,
--     ADD COLUMN suggestion_channel_id VARCHAR(32) NULL;
--
-- Bot tracking (added 2026-11-13): per-guild auto-action settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN bot_threshold INT NULL,
--     ADD COLUMN bot_auto_action ENUM('flag','kick','ban') NOT NULL DEFAULT 'flag',
--     ADD COLUMN bot_suspect_role_id VARCHAR(32) NULL;
--
-- Inventory/shop item types (added 2026-11-13): shop_items columns
-- emoji/type/sell_price/crate_contents are in sql/premium.sql; on an
-- existing database run:
--   ALTER TABLE shop_items
--     ADD COLUMN emoji VARCHAR(16) NULL,
--     ADD COLUMN type ENUM('role','crate','consumable','collectible') NOT NULL DEFAULT 'collectible',
--     ADD COLUMN sell_price INT UNSIGNED NULL,
--     ADD COLUMN crate_contents JSON NULL;

-- Bot tracking: suspicion flags for accounts that look like bots.
-- score 0-100 from the signals in src/utils/botTracker.js; status open
-- until a staff member clears it (/botflag-clear or the dashboard).
CREATE TABLE IF NOT EXISTS bot_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  reason VARCHAR(512) NULL,
  score INT UNSIGNED NOT NULL DEFAULT 0,
  details JSON NULL,
  action_taken VARCHAR(16) NULL,
  flagged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(32) NULL,
  status ENUM('open','reviewed','cleared') NOT NULL DEFAULT 'open',
  PRIMARY KEY (id),
  INDEX idx_bot_flags_guild (guild_id),
  INDEX idx_bot_flags_user (guild_id, user_id),
  INDEX idx_bot_flags_status (guild_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot tracking: daily join counts per guild (total / bot-score / flagged).
CREATE TABLE IF NOT EXISTS bot_join_stats (
  guild_id VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  total_joins INT UNSIGNED NOT NULL DEFAULT 0,
  bot_joins INT UNSIGNED NOT NULL DEFAULT 0,
  flagged_joins INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
