// Local dashboard accounts (1.16.6): username + password login as an
// alternative to Discord OAuth. Passwords are hashed with Node's built-in
// crypto.scrypt (per-user random salt, timing-safe compare) — no new
// dependencies, and no plaintext password or hash is ever logged.
// Roles: admin (everything staff can do + account management), staff
// (all staff actions), viewer (read-only staff pages). Disabled accounts
// cannot log in. The first account is created by the Discord owner at
// /staff/accounts — nothing is seeded.
const crypto = require('crypto');
const db = require('./database');

const ROLES = ['admin', 'staff', 'viewer'];
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

// Stored format: scrypt:<saltHex>:<keyHex>
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    if (typeof stored !== 'string') return false;
    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validateUsername(username) {
  const name = String(username || '').trim();
  if (name.length < 3 || name.length > 32) throw new Error('Username must be 3–32 characters.');
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Username may only contain letters, numbers, underscore, dot, and hyphen.');
  return name;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

function validateRole(role) {
  if (!ROLES.includes(role)) throw new Error('Role must be admin, staff, or viewer.');
  return role;
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    created_by: row.created_by,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

async function findByUsername(username) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT id, username, password_hash, role, disabled, created_by, created_at, last_login_at FROM dashboard_accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
    [String(username || '').trim()],
  );
  const row = rows?.[0];
  return row ? { ...rowToAccount(row), password_hash: row.password_hash } : null;
}

async function findById(id) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT id, username, password_hash, role, disabled, created_by, created_at, last_login_at FROM dashboard_accounts WHERE id = ? LIMIT 1',
    [id],
  );
  const row = rows?.[0];
  return row ? { ...rowToAccount(row), password_hash: row.password_hash } : null;
}

async function listAccounts() {
  if (!db.isEnabled()) return [];
  const rows = await db.query(
    'SELECT id, username, role, disabled, created_by, created_at, last_login_at FROM dashboard_accounts ORDER BY username',
  );
  return (rows || []).map(rowToAccount);
}

async function countEnabledAdmins() {
  if (!db.isEnabled()) return 0;
  const rows = await db.query(
    "SELECT COUNT(*) AS n FROM dashboard_accounts WHERE role = 'admin' AND disabled = 0",
  );
  return rows?.[0]?.n || 0;
}

async function createAccount({ username, password, role, createdBy }) {
  const name = validateUsername(username);
  validatePassword(password);
  const cleanRole = validateRole(role);
  if (!db.isEnabled()) throw new Error('Database unavailable.');
  const existing = await findByUsername(name);
  if (existing) throw new Error('That username is already taken.');
  const result = await db.query(
    'INSERT INTO dashboard_accounts (username, password_hash, role, created_by) VALUES (?, ?, ?, ?)',
    [name, hashPassword(password), cleanRole, String(createdBy || 'owner')],
  );
  return { id: result?.insertId, username: name, role: cleanRole };
}

async function setRole(id, role) {
  const cleanRole = validateRole(role);
  const account = await findById(id);
  if (!account) throw new Error('Account not found.');
  if (account.role === 'admin' && cleanRole !== 'admin') {
    // Demoting the last enabled admin would lock everyone out of accounts.
    const admins = await countEnabledAdmins();
    if (admins <= 1 && !account.disabled) throw new Error('Cannot demote the last enabled admin.');
  }
  await db.query('UPDATE dashboard_accounts SET role = ? WHERE id = ?', [cleanRole, id]);
  return true;
}

async function setDisabled(id, disabled) {
  const account = await findById(id);
  if (!account) throw new Error('Account not found.');
  if (disabled && account.role === 'admin' && !account.disabled) {
    const admins = await countEnabledAdmins();
    if (admins <= 1) throw new Error('Cannot disable the last enabled admin.');
  }
  await db.query('UPDATE dashboard_accounts SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, id]);
  return true;
}

async function resetPassword(id, password) {
  validatePassword(password);
  const account = await findById(id);
  if (!account) throw new Error('Account not found.');
  await db.query('UPDATE dashboard_accounts SET password_hash = ? WHERE id = ?', [hashPassword(password), id]);
  return true;
}

async function deleteAccount(id) {
  const account = await findById(id);
  if (!account) throw new Error('Account not found.');
  if (account.role === 'admin' && !account.disabled) {
    const admins = await countEnabledAdmins();
    if (admins <= 1) throw new Error('Cannot delete the last enabled admin.');
  }
  await db.query('DELETE FROM dashboard_accounts WHERE id = ?', [id]);
  return true;
}

async function touchLastLogin(id) {
  if (!db.isEnabled()) return;
  await db.query('UPDATE dashboard_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]).catch(() => {});
}

// --- Login lockout (in-memory) -------------------------------------------
// Keyed by lowercase username + client IP. 5 failed attempts -> 15-minute
// lockout. The login handler answers with the same generic error whether
// the username is unknown, the password is wrong, the account is disabled,
// or the key is locked out — nothing leaks which one it was.
const failures = new Map();

function lockoutKey(username, ip) {
  return `${String(username || '').trim().toLowerCase()}|${ip || ''}`;
}

function isLockedOut(username, ip) {
  const entry = failures.get(lockoutKey(username, ip));
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) failures.delete(lockoutKey(username, ip));
  return false;
}

function recordFailedLogin(username, ip) {
  const key = lockoutKey(username, ip);
  const entry = failures.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_FAILURES) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  failures.set(key, entry);
}

function clearFailedLogins(username, ip) {
  failures.delete(lockoutKey(username, ip));
}

module.exports = {
  ROLES,
  MIN_PASSWORD_LENGTH,
  MAX_LOGIN_FAILURES,
  LOCKOUT_MS,
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  validateRole,
  findByUsername,
  findById,
  listAccounts,
  countEnabledAdmins,
  createAccount,
  setRole,
  setDisabled,
  resetPassword,
  deleteAccount,
  touchLastLogin,
  isLockedOut,
  recordFailedLogin,
  clearFailedLogins,
};
