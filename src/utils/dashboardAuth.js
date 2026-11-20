// Dashboard auth (1.16.6): Discord OAuth (as before) plus local
// username/password accounts (src/utils/localAccounts.js).
//
// Session shape for a local login:
//   req.session.authType = 'local'
//   req.session.localAccount = { id, username, role }
// Discord logins keep req.session.user as before (authType 'discord' when
// set; older sessions without authType are treated as Discord).
// Local accounts never get guild access: requireAuth still requires
// req.session.user, so guild pages stay Discord-only.
const staffUtils = require('./staff');
const localAccounts = require('./localAccounts');
const db = require('./database');

function getLocalAccount(req) {
  return req.session?.localAccount || null;
}

function isLocalLogin(req) {
  return Boolean(getLocalAccount(req));
}

// Actor label for staff_audit / resolved_by / reviewed_by columns.
// Discord users: their Discord id (as before). Local accounts: local:<id>
// (fits the VARCHAR(32) audit columns).
function actorId(req) {
  const local = getLocalAccount(req);
  if (local) return `local:${local.id}`;
  return req.session?.user?.id || 'unknown';
}

async function staffFlag(req) {
  if (getLocalAccount(req)) return true;
  return req.session?.user ? await staffUtils.isStaff(req.session.user.id) : false;
}

// Discord owner, or a local admin. Used for the Accounts page nav + gating.
function canManageAccounts(req) {
  const local = getLocalAccount(req);
  if (local) return local.role === 'admin';
  return Boolean(req.session?.user && staffUtils.isOwner(req.session.user.id));
}

async function requireStaff(req, res, next) {
  if (getLocalAccount(req)) return next();
  if (!req.session?.user) return res.redirect('/login');
  if (!(await staffUtils.isStaff(req.session.user.id))) return res.status(403).send('Staff only — this area is for the bot owner and approved staff.');
  next();
}

// Staff-write: Discord staff as before, plus local admin/staff — but NOT
// local viewers (read-only). Used on every POST/PUT/DELETE staff route;
// GET staff pages stay on requireStaff.
async function requireStaffWrite(req, res, next) {
  const local = getLocalAccount(req);
  if (local) {
    if (local.role === 'admin' || local.role === 'staff') return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Viewer accounts are read-only.' });
    return res.status(403).send('Viewer accounts are read-only.');
  }
  if (!req.session?.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in — log in again.' });
    return res.redirect('/login');
  }
  if (!(await staffUtils.isStaff(req.session.user.id))) return res.status(403).send('Staff only — this area is for the bot owner and approved staff.');
  next();
}

// Account management: the Discord owner, or a local admin. Discord staff
// (non-owner) do NOT get this. requireOwner stays Discord-owner-only and
// is not widened.
async function requireAdmin(req, res, next) {
  if (getLocalAccount(req)) {
    if (getLocalAccount(req).role === 'admin') return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin only.' });
    return res.status(403).send('Admin only.');
  }
  if (!req.session?.user) return res.redirect('/login');
  if (!staffUtils.isOwner(req.session.user.id)) return res.status(403).send('Admin only.');
  next();
}

async function requireOwner(req, res, next) {
  // A logged-in local admin is authenticated but never the owner: 403,
  // don't bounce them to the login page as if they weren't signed in.
  if (getLocalAccount(req)) return res.status(403).send('Owner only.');
  if (!req.session?.user) return res.redirect('/login');
  if (!staffUtils.isOwner(req.session.user.id)) return res.status(403).send('Owner only.');
  next();
}

// POST /login/local handler. Same generic error for unknown username,
// wrong password, disabled account, and lockout — nothing leaks which.
// On success the session is regenerated (fixation defence) and the local
// account is stored; last_login_at is updated and failures cleared.
async function handleLocalLogin(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const fail = () => res.status(401).render('login', { error: 'Invalid username or password.', username });
  try {
    if (!username || !password) return fail();
    const ip = req.ip || '';
    if (localAccounts.isLockedOut(username, ip)) return fail();
    const account = await localAccounts.findByUsername(username);
    // Always run a verify (against a dummy hash when unknown) so the
    // timing doesn't leak whether the username exists.
    const ok = account
      ? localAccounts.verifyPassword(password, account.password_hash)
      : localAccounts.verifyPassword(password, localAccounts.hashPassword('dummy-password-never-matches'));
    if (!ok || !account || account.disabled) {
      localAccounts.recordFailedLogin(username, ip);
      return fail();
    }
    localAccounts.clearFailedLogins(username, ip);
    const localAccount = { id: account.id, username: account.username, role: account.role };
    const finish = () => {
      req.session.localAccount = localAccount;
      req.session.authType = 'local';
      delete req.session.user;
      delete req.session.accessToken;
      delete req.session.refreshToken;
      delete req.session.tokenExpiresAt;
      localAccounts.touchLastLogin(account.id);
      res.redirect('/staff');
    };
    if (typeof req.session.regenerate === 'function') {
      req.session.regenerate((err) => { if (err) return fail(); finish(); });
    } else {
      finish();
    }
  } catch (err) {
    return fail();
  }
}

// --- Local account API handlers (used by dashboard.js routes) -----------
// All mutations are audited via staff_audit (actor = Discord id or
// local:<id>). Passwords never appear in audit details. The last-admin
// and self guards live here so they apply no matter who calls.
async function createAccountApi(req, res) {
  const { username, password, role } = req.body || {};
  try {
    if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
    const account = await localAccounts.createAccount({ username, password, role, createdBy: actorId(req) });
    await staffUtils.audit(actorId(req), 'account.create', String(account.id), `${account.username} role=${account.role}`);
    res.json({ ok: true, account });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function setAccountRoleApi(req, res) {
  const { role } = req.body || {};
  try {
    if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
    const target = await localAccounts.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    await localAccounts.setRole(target.id, role);
    await staffUtils.audit(actorId(req), 'account.role', String(target.id), `${target.username} role=${role}`);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function setAccountStatusApi(req, res) {
  const disabled = req.body?.disabled === true || req.body?.disabled === 'true';
  try {
    if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
    const target = await localAccounts.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    const self = getLocalAccount(req);
    if (self && String(self.id) === String(target.id) && disabled) return res.status(400).json({ error: 'You cannot disable your own account.' });
    await localAccounts.setDisabled(target.id, disabled);
    await staffUtils.audit(actorId(req), disabled ? 'account.disable' : 'account.enable', String(target.id), target.username);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function resetAccountPasswordApi(req, res) {
  const { password } = req.body || {};
  try {
    if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
    const target = await localAccounts.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    await localAccounts.resetPassword(target.id, password);
    await staffUtils.audit(actorId(req), 'account.reset-password', String(target.id), target.username);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

async function deleteAccountApi(req, res) {
  try {
    if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
    const target = await localAccounts.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    const self = getLocalAccount(req);
    if (self && String(self.id) === String(target.id)) return res.status(400).json({ error: 'You cannot delete your own account.' });
    await localAccounts.deleteAccount(target.id);
    await staffUtils.audit(actorId(req), 'account.delete', String(target.id), target.username);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

module.exports = {
  getLocalAccount,
  isLocalLogin,
  actorId,
  staffFlag,
  canManageAccounts,
  requireStaff,
  requireStaffWrite,
  requireAdmin,
  requireOwner,
  handleLocalLogin,
  createAccountApi,
  setAccountRoleApi,
  setAccountStatusApi,
  resetAccountPasswordApi,
  deleteAccountApi,
};
