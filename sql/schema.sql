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
  welcome_image_enabled TINYINT(1) NOT NULL DEFAULT 0,
  welcome_image_only TINYINT(1) NOT NULL DEFAULT 0,
  welcome_dm_enabled TINYINT(1) NOT NULL DEFAULT 0,
  welcome_dm_message TEXT NULL,
  ai_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ai_channel_id VARCHAR(32) NULL,
  modmail_enabled TINYINT(1) NOT NULL DEFAULT 0,
  modmail_category_id VARCHAR(32) NULL,
  voice_xp_per_minute INT NULL,
  media_channels JSON NULL,
  ghostping_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ghostping_channel_id VARCHAR(32) NULL,
  thread_archive_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
  confessions_enabled TINYINT(1) NOT NULL DEFAULT 0,
  confessions_channel_id VARCHAR(32) NULL,
  confessions_require_approval TINYINT(1) NOT NULL DEFAULT 1,
  birthday_role_id VARCHAR(32) NULL,
  streak_bonus_per_day INT NOT NULL DEFAULT 25,
  streak_milestone_bonuses JSON NULL,
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
  antinuke_enabled TINYINT(1) NOT NULL DEFAULT 0,
  antinuke_action VARCHAR(16) NOT NULL DEFAULT 'kick',
  antinuke_threshold INT NOT NULL DEFAULT 5,
  antinuke_log_channel_id VARCHAR(32) NULL,
  antinuke_whitelist_roles JSON NULL,
  verification_enabled TINYINT(1) NOT NULL DEFAULT 0,
  verification_channel_id VARCHAR(32) NULL,
  verification_role_id VARCHAR(32) NULL,
  verification_mode ENUM('button','captcha') NOT NULL DEFAULT 'button',
  verification_panel_message_id VARCHAR(32) NULL,
  tempvc_create_channel_id VARCHAR(32) NULL,
  tempvc_category_id VARCHAR(32) NULL,
  birthday_channel_id VARCHAR(32) NULL,
  birthday_announce_hour INT NOT NULL DEFAULT 9,
  bump_channel_id VARCHAR(32) NULL,
  default_weather_location VARCHAR(128) NULL,
  weather_units ENUM('imperial','metric') NOT NULL DEFAULT 'imperial',
  lottery_ticket_price INT NOT NULL DEFAULT 100,
  lottery_channel_id VARCHAR(32) NULL,
  dj_enabled TINYINT(1) NOT NULL DEFAULT 0,
  dj_only_skip TINYINT(1) NOT NULL DEFAULT 1,
  prestige_role_id VARCHAR(32) NULL,
  music247_enabled TINYINT(1) NOT NULL DEFAULT 0,
  music247_channel_id VARCHAR(32) NULL,
  booster_role_id VARCHAR(32) NULL,
  robbery_enabled TINYINT(1) NOT NULL DEFAULT 1,
  new_member_link_enabled TINYINT(1) NOT NULL DEFAULT 0,
  new_member_link_days INT NOT NULL DEFAULT 7,
  afk_voice_enabled TINYINT(1) NOT NULL DEFAULT 0,
  afk_voice_minutes INT NOT NULL DEFAULT 30,
  afk_voice_channel_id VARCHAR(32) NULL,
  afk_voice_exempt_role_id VARCHAR(32) NULL,
  image_starboard_channel_id VARCHAR(32) NULL,
  image_starboard_threshold INT NOT NULL DEFAULT 3,
  levelup_channel_id VARCHAR(32) NULL,
  afk_autocreate_enabled TINYINT(1) NOT NULL DEFAULT 0,
  afk_channel_id VARCHAR(32) NULL,
  afk_max_users INT NOT NULL DEFAULT 10,
  autopublish_channels JSON NULL,
  reengage_enabled TINYINT(1) NOT NULL DEFAULT 0,
  reengage_days INT NOT NULL DEFAULT 30,
  reengage_channel_id VARCHAR(32) NULL,
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
  include_clip TINYINT(1) NOT NULL DEFAULT 1,
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
  min_days_in_server INT NULL,
  min_level INT NULL,
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
  required_role_id VARCHAR(32) NULL,
  min_days_in_server INT NULL,
  min_level INT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
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
  dup_enabled TINYINT(1) NOT NULL DEFAULT 0,
  dup_max INT UNSIGNED NOT NULL DEFAULT 3,
  caps_enabled TINYINT(1) NOT NULL DEFAULT 0,
  caps_min_length INT UNSIGNED NOT NULL DEFAULT 10,
  caps_percent INT UNSIGNED NOT NULL DEFAULT 70,
  mention_enabled TINYINT(1) NOT NULL DEFAULT 0,
  mention_max INT UNSIGNED NOT NULL DEFAULT 5,
  link_max INT UNSIGNED NOT NULL DEFAULT 0,
  antispam_action ENUM('delete','warn','timeout','delete_warn','delete_timeout') NOT NULL DEFAULT 'delete_warn',
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

-- v1.2.0 additions (2026-11-13): verification gate, counting, bump reminders,
-- temporary voice channels, birthdays, reaction-role requirements.
--
-- New guild_settings columns (on an existing database run):
--   ALTER TABLE guild_settings
--     ADD COLUMN verification_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN verification_channel_id VARCHAR(32) NULL,
--     ADD COLUMN verification_role_id VARCHAR(32) NULL,
--     ADD COLUMN verification_mode ENUM('button','captcha') NOT NULL DEFAULT 'button',
--     ADD COLUMN verification_panel_message_id VARCHAR(32) NULL,
--     ADD COLUMN tempvc_create_channel_id VARCHAR(32) NULL,
--     ADD COLUMN tempvc_category_id VARCHAR(32) NULL,
--     ADD COLUMN birthday_channel_id VARCHAR(32) NULL,
--     ADD COLUMN birthday_announce_hour INT NOT NULL DEFAULT 9,
--     ADD COLUMN bump_channel_id VARCHAR(32) NULL;
-- Reaction-role requirements (existing database):
--   ALTER TABLE reaction_roles
--     ADD COLUMN required_role_id VARCHAR(32) NULL,
--     ADD COLUMN min_days_in_server INT NULL,
--     ADD COLUMN min_level INT NULL;

CREATE TABLE IF NOT EXISTS verification_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'button',
  status ENUM('granted','failed','pending') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_verification_guild_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS counting_settings (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  current_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_counter_id VARCHAR(32) NULL,
  highest_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bump_settings (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  last_bump_at TIMESTAMP NULL,
  last_reminder_at TIMESTAMP NULL,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS temp_channels (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  owner_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, channel_id),
  INDEX idx_temp_channels_owner (guild_id, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS birthdays (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  day TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NULL,
  announced_last_year SMALLINT UNSIGNED NULL,
  PRIMARY KEY (guild_id, user_id),
  INDEX idx_birthdays_date (guild_id, month, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.2.7 (2026-11-13): weather defaults (Open-Meteo, no key).
--   ALTER TABLE guild_settings
--     ADD COLUMN default_weather_location VARCHAR(128) NULL,
--     ADD COLUMN weather_units ENUM('imperial','metric') NOT NULL DEFAULT 'imperial';

-- v1.3.1 (2026-11-13): giveaway requirements.
--   ALTER TABLE giveaways
--     ADD COLUMN min_days_in_server INT NULL,
--     ADD COLUMN min_level INT NULL;
-- v1.3.2 (2026-11-13): ticket transcripts index (files stay in transcripts/).
CREATE TABLE IF NOT EXISTS ticket_transcripts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  ticket_id BIGINT UNSIGNED NULL,
  user_id VARCHAR(32) NULL,
  closed_by VARCHAR(32) NULL,
  closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  file_path VARCHAR(512) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transcript_file (file_path),
  INDEX idx_transcripts_guild (guild_id),
  INDEX idx_transcripts_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.3 (2026-11-13): XP boosts.
CREATE TABLE IF NOT EXISTS xp_boosts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  multiplier DECIMAL(3,1) NOT NULL DEFAULT 2.0,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NOT NULL,
  created_by VARCHAR(32) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  INDEX idx_xp_boosts_guild (guild_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.4 (2026-11-13): daily analytics snapshots.
CREATE TABLE IF NOT EXISTS guild_daily_stats (
  guild_id VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  member_count INT UNSIGNED NOT NULL DEFAULT 0,
  messages_count INT UNSIGNED NOT NULL DEFAULT 0,
  joins INT UNSIGNED NOT NULL DEFAULT 0,
  leaves INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.5 (2026-11-13): level-up reward reminders.
CREATE TABLE IF NOT EXISTS level_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  target_level INT UNSIGNED NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reminded_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_level_reminders_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.6 (2026-11-13): welcome images.
--   ALTER TABLE guild_settings
--     ADD COLUMN welcome_image_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN welcome_image_only TINYINT(1) NOT NULL DEFAULT 0;

-- v1.4.1 (2026-11-13): AI chat usage log.
CREATE TABLE IF NOT EXISTS ai_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  tokens INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ai_usage_guild (guild_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.4.2 (2026-11-13): Minecraft live status widgets.
CREATE TABLE IF NOT EXISTS mc_widgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  server_id BIGINT UNSIGNED NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_widget (guild_id, server_id),
  INDEX idx_mc_widgets_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.4.3 (2026-11-13): voice sessions (voice XP + voice stats).
CREATE TABLE IF NOT EXISTS voice_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  minutes INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_voice_sessions_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.4.4 (2026-11-13): self-assignable color roles.
CREATE TABLE IF NOT EXISTS color_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  hex VARCHAR(7) NOT NULL,
  name VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_color_role (guild_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.4.5 (2026-11-13): stream clip toggle.
--   ALTER TABLE streamers ADD COLUMN include_clip TINYINT(1) NOT NULL DEFAULT 1;

-- v1.4.6 (2026-11-13): modmail.
CREATE TABLE IF NOT EXISTS modmail_threads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  closed_by VARCHAR(32) NULL,
  PRIMARY KEY (id),
  INDEX idx_modmail_threads (guild_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modmail_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id BIGINT UNSIGNED NOT NULL,
  author_id VARCHAR(32) NOT NULL,
  author_type ENUM('user','staff') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_modmail_messages_thread (thread_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modmail_blocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  blocked_by VARCHAR(32) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_modmail_block (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.4.1 (2026-11-13): AI chat settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN ai_channel_id VARCHAR(32) NULL;
-- v1.4.6 (2026-11-13): modmail settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN modmail_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN modmail_category_id VARCHAR(32) NULL;

-- v1.11.1 (2026-11-13): DJ mode settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN dj_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN dj_only_skip TINYINT(1) NOT NULL DEFAULT 1;
-- v1.11.4 (2026-11-13): prestige role setting.
--   ALTER TABLE guild_settings ADD COLUMN prestige_role_id VARCHAR(32) NULL;

-- v1.11.2 (2026-11-13): emoji manager log.
CREATE TABLE IF NOT EXISTS emoji_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  action ENUM('add','remove') NOT NULL,
  emoji_name VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_emoji_logs_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.11.3 (2026-11-13): countdowns.
CREATE TABLE IF NOT EXISTS countdowns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  title VARCHAR(256) NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_countdowns_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.11.4 (2026-11-13): prestige — one column on the existing levels table.
--   ALTER TABLE user_levels ADD COLUMN prestige INT UNSIGNED NOT NULL DEFAULT 0;

-- v1.11.5 (2026-11-13): multiple ticket panels per guild.
CREATE TABLE IF NOT EXISTS ticket_panels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  category_id VARCHAR(32) NULL,
  staff_role_id VARCHAR(32) NULL,
  title VARCHAR(256) NOT NULL,
  description TEXT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ticket_panels_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--   ALTER TABLE tickets ADD COLUMN panel_id BIGINT UNSIGNED NULL;

-- v1.11.6 (2026-11-13): invite-code → role rules.
CREATE TABLE IF NOT EXISTS invite_role_rules (
  guild_id VARCHAR(32) NOT NULL,
  invite_code VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, invite_code),
  INDEX idx_invite_role_rules_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.1 (2026-11-13): saved music playlists (per-user, per-server).
CREATE TABLE IF NOT EXISTS music_playlists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  name VARCHAR(50) NOT NULL,
  tracks JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_music_playlist (guild_id, user_id, name),
  INDEX idx_music_playlists_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.2 (2026-11-13): daily trivia (one question per day per guild).
CREATE TABLE IF NOT EXISTS trivia_settings (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  hour TINYINT UNSIGNED NOT NULL DEFAULT 12,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trivia_daily (
  guild_id VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  question TEXT NOT NULL,
  answer VARCHAR(255) NOT NULL,
  options_json JSON NOT NULL,
  message_id VARCHAR(32) NULL,
  channel_id VARCHAR(32) NULL,
  winner_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trivia_scores (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  wins INT UNSIGNED NOT NULL DEFAULT 0,
  points INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.3 (2026-11-13): economy heists.
CREATE TABLE IF NOT EXISTS heists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  bet INT UNSIGNED NOT NULL,
  members_json JSON NOT NULL,
  status ENUM('forming','success','failed') NOT NULL DEFAULT 'forming',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_heists_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.4 (2026-11-13): member milestones.
CREATE TABLE IF NOT EXISTS milestone_settings (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS milestones_hit (
  guild_id VARCHAR(32) NOT NULL,
  milestone INT UNSIGNED NOT NULL,
  triggered_by VARCHAR(32) NULL,
  hit_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, milestone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.5 (2026-11-13): button role menus (select-menu role pickers).
CREATE TABLE IF NOT EXISTS role_menus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_role_menus_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_menu_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  menu_id BIGINT UNSIGNED NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  label VARCHAR(100) NOT NULL,
  emoji VARCHAR(64) NULL,
  description VARCHAR(100) NULL,
  required_role_id VARCHAR(32) NULL,
  min_days_in_server INT NULL,
  min_level INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_menu_item (menu_id, role_id),
  INDEX idx_role_menu_items_menu (menu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10.6 (2026-11-13): auto-translate settings.
CREATE TABLE IF NOT EXISTS translate_settings (
  guild_id VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  channels_json JSON NOT NULL,
  target_lang VARCHAR(5) NOT NULL DEFAULT 'en',
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.5.2 (2026-11-13): temporary roles.
CREATE TABLE IF NOT EXISTS temp_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  granted_by VARCHAR(32) NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  removed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_temp_roles_guild (guild_id, removed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.5.4 (2026-11-13): server backups (metadata; the JSON lives in backups/).
CREATE TABLE IF NOT EXISTS server_backups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name VARCHAR(128) NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_server_backups_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.5.5 (2026-11-13): quotes.
CREATE TABLE IF NOT EXISTS quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  author_id VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  quoted_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_msg (guild_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.5.1 (2026-11-13): media auto-threads.
--   ALTER TABLE guild_settings ADD COLUMN media_channels JSON NULL;
-- v1.5.3 (2026-11-13): anti-ghost-ping.
--   ALTER TABLE guild_settings
--     ADD COLUMN ghostping_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN ghostping_channel_id VARCHAR(32) NULL;

-- v1.9.1 (2026-11-13): temporary bans.
CREATE TABLE IF NOT EXISTS temp_bans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  banned_by VARCHAR(32) NOT NULL,
  reason VARCHAR(512) NULL,
  banned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  unbanned TINYINT(1) NOT NULL DEFAULT 0,
  unbanned_at TIMESTAMP NULL,
  cancelled TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_temp_bans_guild (guild_id),
  INDEX idx_temp_bans_expiry (unbanned, cancelled, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.9.2 (2026-11-13): purge audit log.
CREATE TABLE IF NOT EXISTS purge_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  moderator_id VARCHAR(32) NOT NULL,
  count INT UNSIGNED NOT NULL,
  filter VARCHAR(255) NOT NULL DEFAULT 'all',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_purge_logs_guild (guild_id),
  INDEX idx_purge_logs_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.9.3 (2026-11-13): welcome DM settings live in guild_settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN welcome_dm_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN welcome_dm_message TEXT NULL;

-- v1.9.4 (2026-11-13): lottery settings live in guild_settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN lottery_ticket_price INT NOT NULL DEFAULT 100,
--     ADD COLUMN lottery_channel_id VARCHAR(32) NULL;

-- v1.9.5 (2026-11-13): server rules (one rules message per guild).
CREATE TABLE IF NOT EXISTS server_rules (
  guild_id VARCHAR(32) PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  content TEXT NOT NULL,
  channel_id VARCHAR(32) NULL,
  message_id VARCHAR(32) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.9.6 (2026-11-13): anti-nuke event audit log + settings in guild_settings.
--   ALTER TABLE guild_settings
--     ADD COLUMN antinuke_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN antinuke_action VARCHAR(16) NOT NULL DEFAULT 'kick',
--     ADD COLUMN antinuke_threshold INT NOT NULL DEFAULT 5,
--     ADD COLUMN antinuke_log_channel_id VARCHAR(32) NULL,
--     ADD COLUMN antinuke_whitelist_roles JSON NULL;
CREATE TABLE IF NOT EXISTS antinuke_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  action VARCHAR(32) NOT NULL,
  target_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_antinuke_guild_time (guild_id, created_at),
  INDEX idx_antinuke_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.12.x (2026-11-13): guild_settings columns for 24/7 music, booster
-- role, robbery toggle, and the new-member link block. Existing installs:
--   ALTER TABLE guild_settings
--     ADD COLUMN music247_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN music247_channel_id VARCHAR(32) NULL,
--     ADD COLUMN booster_role_id VARCHAR(32) NULL,
--     ADD COLUMN robbery_enabled TINYINT(1) NOT NULL DEFAULT 1,
--     ADD COLUMN new_member_link_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN new_member_link_days INT NOT NULL DEFAULT 7;

-- v1.12.3 (2026-11-13): work jobs — per-server job catalog + chosen job.
CREATE TABLE IF NOT EXISTS work_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  min_payout INT UNSIGNED NOT NULL DEFAULT 30,
  max_payout INT UNSIGNED NOT NULL DEFAULT 80,
  cost INT UNSIGNED NOT NULL DEFAULT 0,
  required_level INT UNSIGNED NOT NULL DEFAULT 0,
  flavor_text VARCHAR(256) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_work_job (guild_id, name),
  INDEX idx_work_jobs_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_jobs (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id),
  INDEX idx_user_jobs_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.12.4 (2026-11-13): giveaway bonus entries.
--   ALTER TABLE giveaways
--     ADD COLUMN bonus_role_id VARCHAR(32) NULL,
--     ADD COLUMN bonus_entries INT NULL;
CREATE TABLE IF NOT EXISTS giveaway_bonus (
  giveaway_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  bonus_entries INT UNSIGNED NOT NULL DEFAULT 0,
  reason VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (giveaway_id, user_id),
  INDEX idx_giveaway_bonus_giveaway (giveaway_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.12.6 (2026-11-13): robbery attempts (cooldowns + audit trail).
CREATE TABLE IF NOT EXISTS rob_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  target_id VARCHAR(32) NOT NULL,
  result ENUM('success','fail') NOT NULL,
  amount INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rob_guild_user (guild_id, user_id, created_at),
  INDEX idx_rob_guild_time (guild_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.6.1 (2026-11-13): per-channel thread archive overrides.
CREATE TABLE IF NOT EXISTS thread_archive_settings (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  archive_minutes INT UNSIGNED NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.6.2 (2026-11-13): XP role shop (per-server catalog).
CREATE TABLE IF NOT EXISTS xp_shop_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  xp_price INT UNSIGNED NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_xp_shop_item (guild_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.6.4 (2026-11-13): confessions (author stored for moderation only,
-- NEVER shown publicly).
CREATE TABLE IF NOT EXISTS confessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  status ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_confessions_guild (guild_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.6.5 (2026-11-13): birthday roles granted per day.
CREATE TABLE IF NOT EXISTS birthday_roles_granted (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  granted_on DATE NOT NULL,
  PRIMARY KEY (guild_id, user_id, granted_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- economy_users was used by the economy code but had no CREATE TABLE in
-- this file (pre-existing gap, fixed 1.6.3 along with the streak columns).
CREATE TABLE IF NOT EXISTS economy_users (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  balance INT NOT NULL DEFAULT 0,
  bank INT NOT NULL DEFAULT 0,
  last_daily TIMESTAMP NULL,
  last_work TIMESTAMP NULL,
  daily_streak INT UNSIGNED NOT NULL DEFAULT 0,
  best_streak INT UNSIGNED NOT NULL DEFAULT 0,
  last_daily_date DATE NULL,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.6.3 (2026-11-13): daily streaks.
--   ALTER TABLE economy_users
--     ADD COLUMN daily_streak INT UNSIGNED NOT NULL DEFAULT 0,
--     ADD COLUMN best_streak INT UNSIGNED NOT NULL DEFAULT 0,
--     ADD COLUMN last_daily_date DATE NULL;

-- v1.7.1 (2026-11-13): Wordle / daily games.
CREATE TABLE IF NOT EXISTS wordle_games (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  word VARCHAR(5) NOT NULL,
  guesses JSON NOT NULL,
  won TINYINT(1) NOT NULL DEFAULT 0,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  streak INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.2 (2026-11-13): event scheduler.
CREATE TABLE IF NOT EXISTS scheduled_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  title VARCHAR(256) NOT NULL,
  description TEXT NULL,
  starts_at TIMESTAMP NOT NULL,
  created_by VARCHAR(32) NULL,
  message_id VARCHAR(32) NULL,
  status ENUM('upcoming','started','cancelled') NOT NULL DEFAULT 'upcoming',
  reminded TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_events_guild (guild_id, status, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  status ENUM('going','maybe','not_going') NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.3 (2026-11-13): slowmode presets (day/night schedule per channel).
CREATE TABLE IF NOT EXISTS slowmode_schedules (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  preset_name VARCHAR(64) NOT NULL DEFAULT 'default',
  day_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  night_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  night_start_hour INT UNSIGNED NOT NULL DEFAULT 22,
  night_end_hour INT UNSIGNED NOT NULL DEFAULT 8,
  PRIMARY KEY (guild_id, channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.4 (2026-11-13): AFK voice kick move log.
CREATE TABLE IF NOT EXISTS afk_voice_moves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  from_channel_id VARCHAR(32) NULL,
  to_channel_id VARCHAR(32) NULL,
  disconnected TINYINT(1) NOT NULL DEFAULT 0,
  moved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_afk_moves_guild (guild_id, moved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.6 (2026-11-13): custom status roles (trigger text -> role).
CREATE TABLE IF NOT EXISTS status_roles (
  guild_id VARCHAR(32) NOT NULL,
  trigger_text VARCHAR(128) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, trigger_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.8 (2026-11-13): embed builder (bot-posted embeds, re-editable).
CREATE TABLE IF NOT EXISTS embeds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  channel_id VARCHAR(32) NOT NULL,
  embed_json JSON NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_embeds_guild (guild_id, channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.8.2 (2026-11-13): ticket ratings (1-5 stars + optional comment).
CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  rating INT UNSIGNED NOT NULL,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.8.4 (2026-11-13): invite rewards (milestones -> role or coins).
CREATE TABLE IF NOT EXISTS invite_rewards (
  guild_id VARCHAR(32) NOT NULL,
  invites_required INT UNSIGNED NOT NULL,
  reward_type ENUM('role','coins') NOT NULL,
  role_id VARCHAR(32) NULL,
  coins INT UNSIGNED NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, invites_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invite_reward_grants (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  invites_required INT UNSIGNED NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id, invites_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.8.6 (2026-11-13): message bookmarks (excerpt only, max 500 chars).
CREATE TABLE IF NOT EXISTS bookmarks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  author_id VARCHAR(32) NULL,
  content_excerpt VARCHAR(500) NULL,
  note VARCHAR(256) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_bookmarks_user (guild_id, user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.8.8 (2026-11-13): inactive-member re-engagement log + opt-outs.
CREATE TABLE IF NOT EXISTS reengage_logs (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  messaged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reengage_optouts (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  opted_out_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.13.x tables (reminders reuse `reminders`; AFK reuses `afk_users`).
CREATE TABLE IF NOT EXISTS reports (
  id INT NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  reporter_id VARCHAR(32) NOT NULL,
  reported_id VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_reports_guild_status (guild_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lockdowns (
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  target_id VARCHAR(32) NOT NULL,
  allow BIGINT NULL,
  deny BIGINT NULL,
  locked_by VARCHAR(32) NOT NULL,
  locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, channel_id, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS counting_counts (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  correct_counts INT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_quests (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  quest_id VARCHAR(32) NOT NULL,
  quest_date DATE NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id, quest_id, quest_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roleshop_items (
  guild_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  price INT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roleshop_purchases (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  price INT NOT NULL,
  purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_color_roles (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_weather (
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  location VARCHAR(128) NOT NULL,
  PRIMARY KEY (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.7.x / v1.8.x migration note for existing installs: the guild_settings
-- columns added after 1.12.6 are NOT created by CREATE TABLE IF NOT EXISTS
-- on a table that already exists. Run once:
--   ALTER TABLE guild_settings
--     ADD COLUMN dj_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN dj_only_skip TINYINT(1) NOT NULL DEFAULT 1,
--     ADD COLUMN prestige_role_id VARCHAR(32) NULL,
--     ADD COLUMN music247_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN music247_channel_id VARCHAR(32) NULL,
--     ADD COLUMN booster_role_id VARCHAR(32) NULL,
--     ADD COLUMN robbery_enabled TINYINT(1) NOT NULL DEFAULT 1,
--     ADD COLUMN new_member_link_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN new_member_link_days INT NOT NULL DEFAULT 7,
--     ADD COLUMN afk_voice_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN afk_voice_minutes INT NOT NULL DEFAULT 30,
--     ADD COLUMN afk_voice_channel_id VARCHAR(32) NULL,
--     ADD COLUMN afk_voice_exempt_role_id VARCHAR(32) NULL,
--     ADD COLUMN image_starboard_channel_id VARCHAR(32) NULL,
--     ADD COLUMN image_starboard_threshold INT NOT NULL DEFAULT 3,
--     ADD COLUMN levelup_channel_id VARCHAR(32) NULL,
--     ADD COLUMN afk_autocreate_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN afk_channel_id VARCHAR(32) NULL,
--     ADD COLUMN afk_max_users INT NOT NULL DEFAULT 10,
--     ADD COLUMN autopublish_channels JSON NULL,
--     ADD COLUMN reengage_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN reengage_days INT NOT NULL DEFAULT 30,
--     ADD COLUMN reengage_channel_id VARCHAR(32) NULL;
-- v1.8.1 / v1.8.9 migration note for existing installs:
--   ALTER TABLE polls ADD COLUMN final_counts JSON NULL;
--   ALTER TABLE user_levels ADD COLUMN messages INT UNSIGNED NOT NULL DEFAULT 0;

-- v1.14.1 (2026-11-15): reaction-role pause/resume.
--   ALTER TABLE reaction_roles ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1;
-- v1.14.2 (2026-11-15): member + moderation event logging.
CREATE TABLE IF NOT EXISTS logging_settings (
  guild_id VARCHAR(32) NOT NULL,
  log_channel_id VARCHAR(32) NULL,
  log_joins TINYINT(1) NOT NULL DEFAULT 1,
  log_leaves TINYINT(1) NOT NULL DEFAULT 1,
  log_bans TINYINT(1) NOT NULL DEFAULT 1,
  log_kicks TINYINT(1) NOT NULL DEFAULT 1,
  log_timeouts TINYINT(1) NOT NULL DEFAULT 1,
  log_role_changes TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.14.3 (2026-11-15): automated responses (phrase triggers).
CREATE TABLE IF NOT EXISTS autoresponders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  `trigger` VARCHAR(128) NOT NULL,
  response VARCHAR(2000) NOT NULL,
  match_type ENUM('contains','exact') NOT NULL DEFAULT 'contains',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autoresponder (guild_id, `trigger`),
  INDEX idx_autoresponders_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.14.4 (2026-11-15): antispam detectors (new columns on automod_settings).
--   ALTER TABLE automod_settings
--     ADD COLUMN dup_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN dup_max INT UNSIGNED NOT NULL DEFAULT 3,
--     ADD COLUMN caps_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN caps_min_length INT UNSIGNED NOT NULL DEFAULT 10,
--     ADD COLUMN caps_percent INT UNSIGNED NOT NULL DEFAULT 70,
--     ADD COLUMN mention_enabled TINYINT(1) NOT NULL DEFAULT 0,
--     ADD COLUMN mention_max INT UNSIGNED NOT NULL DEFAULT 5,
--     ADD COLUMN link_max INT UNSIGNED NOT NULL DEFAULT 0,
--     ADD COLUMN antispam_action ENUM('delete','warn','timeout','delete_warn','delete_timeout') NOT NULL DEFAULT 'delete_warn';

-- v1.14.5 (2026-11-15): content filter — blocked words + harmful-link domains.
CREATE TABLE IF NOT EXISTS content_filter_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  type ENUM('word','domain') NOT NULL,
  value VARCHAR(128) NOT NULL,
  action ENUM('delete','warn','timeout','delete_warn','delete_timeout') NOT NULL DEFAULT 'delete_warn',
  severity ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_content_filter_rule (guild_id, type, value),
  INDEX idx_content_filter_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
