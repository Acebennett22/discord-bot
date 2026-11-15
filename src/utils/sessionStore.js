// Persistent dashboard login sessions (1.15.4).
//
// express-session's default MemoryStore keeps sessions in process memory, so
// every dashboard restart logged everyone out (and the 24h cookie did the
// rest). This module returns a store that lazily picks its backend on first
// use:
//   - MySQL (express-mysql-session, `sessions` table, auto-created) when the
//     bot's database is up — sessions survive dashboard restarts.
//   - MemoryStore with a one-time console warning when MySQL is unavailable
//     — the dashboard still boots, sessions just don't persist.
//
// The choice is made once per process. Dashboard startup awaits
// db.initDatabase() before listen, so by the time any request arrives
// db.isEnabled() reflects reality. If the MySQL store fails to initialize
// (e.g. the sessions table can't be created), it falls back to MemoryStore
// instead of 500ing every request.
//
// NOTE: the setup wizard's one-time link is unaffected — the link token is
// still consumed on first presentation (single-use). Only the resulting
// authorized session persists across restarts, like any login session.
const session = require('express-session');
const db = require('./database');
const config = require('./config');

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

function createSessionStore() {
  const MySQLStore = require('express-mysql-session')(session);

  class DelegatingStore extends session.Store {
    constructor() {
      super();
      this._backendPromise = null;
    }

    _backend() {
      if (!this._backendPromise) {
        this._backendPromise = (async () => {
          if (db.isEnabled()) {
            const d = config.database || {};
            try {
              const store = new MySQLStore({
                host: d.host,
                port: d.port || 3306,
                user: d.user,
                password: d.password,
                database: d.database,
                connectionLimit: 5,
                expiration: SESSION_MAX_AGE_MS,
                createDatabaseTable: true,
              });
              await store.onReady();
              console.log('[dashboard] Login sessions stored in MySQL (survive restarts, 30-day cookie).');
              return store;
            } catch (err) {
              console.warn('[dashboard] MySQL session store unavailable — falling back to MemoryStore; logins will not survive a dashboard restart:', err.message);
            }
          } else {
            console.warn('[dashboard] MySQL unavailable — login sessions use MemoryStore and will not survive a dashboard restart.');
          }
          return new session.MemoryStore();
        })();
      }
      return this._backendPromise;
    }

    _delegate(method, args, callback) {
      const cb = typeof callback === 'function' ? callback : () => {};
      this._backend().then(
        (store) => store[method](...args, cb),
        (err) => cb(err),
      );
    }

    get(sid, cb) { this._delegate('get', [sid], cb); }
    set(sid, sess, cb) { this._delegate('set', [sid, sess], cb); }
    touch(sid, sess, cb) { this._delegate('touch', [sid, sess], cb); }
    destroy(sid, cb) { this._delegate('destroy', [sid], cb); }
    all(cb) { this._delegate('all', [], cb); }
    clear(cb) { this._delegate('clear', [], cb); }
    length(cb) { this._delegate('length', [], cb); }
  }

  return new DelegatingStore();
}

module.exports = { createSessionStore, SESSION_MAX_AGE_MS };
