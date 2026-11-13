// Staff access: the owner (config.ownerId) is always staff implicitly.
// Additional staff come from config.json `staffUserIds` (bootstrap) and the
// MySQL staff_users table (managed on the staff page by the owner).
const config = require('./config');
const db = require('./database');

function isOwner(userId) {
  return Boolean(config.ownerId) && userId === config.ownerId;
}

async function isStaff(userId) {
  if (!userId) return false;
  if (isOwner(userId)) return true;
  if ((config.staffUserIds || []).includes(userId)) return true;
  if (!db.isEnabled()) return false;
  const rows = await db.query('SELECT 1 FROM staff_users WHERE user_id = ?', [userId]);
  return Boolean(rows?.length);
}

async function listStaff() {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT user_id, added_by, role, created_at FROM staff_users ORDER BY created_at')) || [];
}

async function getStaffRole(userId) {
  if (isOwner(userId)) return 'owner';
  if ((config.staffUserIds || []).includes(userId)) return 'staff';
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT role FROM staff_users WHERE user_id = ?', [userId]);
  return rows?.[0]?.role || null;
}

async function addStaff(actorId, targetId, role = 'staff') {
  if (!db.isEnabled()) return false;
  await db.query(
    "INSERT INTO staff_users (user_id, added_by, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)",
    [targetId, actorId, role],
  );
  await audit(actorId, 'staff.add', targetId, `role=${role}`);
  return true;
}

async function removeStaff(actorId, targetId) {
  if (!db.isEnabled()) return false;
  await db.query('DELETE FROM staff_users WHERE user_id = ?', [targetId]);
  await audit(actorId, 'staff.remove', targetId, null);
  return true;
}

async function audit(actorId, action, targetId, details) {
  if (!db.isEnabled()) return;
  await db.query('INSERT INTO staff_audit (actor_id, action, target_id, details) VALUES (?, ?, ?, ?)',
    [actorId, action, targetId, details]);
}

module.exports = { isOwner, isStaff, getStaffRole, listStaff, addStaff, removeStaff, audit };
