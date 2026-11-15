// Verify 1.15.14: Staff Errors table CSS/markup fix.
// Renders the staff errors view with sample rows and asserts the new
// classes/attributes are present; checks style.css carries the new rules.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const rows = [
  { id: 101, level: 'error', shard_id: 0, command_name: 'music play', user_id: '1', message: 'TypeError [ERR_INVALID_URL]: Invalid URL at stream_from_info — the YouTube extractor returned no playable formats for this video, so playback was skipped and the queue advanced to the next track in line.', created_at: new Date('2026-11-15T23:31:11Z'), resolved: false },
  { id: 100, level: 'warn', shard_id: 0, command_name: 'translate', user_id: '1', message: 'settings.channels.includes is not a function', created_at: new Date('2026-11-15T23:10:05Z'), resolved: true },
  { id: 99, level: 'error', shard_id: 1, command_name: null, user_id: null, message: 'GET /dashboard/settings', created_at: new Date('2026-11-15T22:58:44Z'), resolved: false },
  { id: 98, level: 'info', shard_id: 0, command_name: 'ready', user_id: null, message: 'Bot logged in as Vikings Hall Clerk', created_at: new Date('2026-11-15T22:00:00Z'), resolved: false },
  { id: 97, level: 'error', shard_id: 0, command_name: 'x'.repeat(40), user_id: '1', message: '<h1>Your servers</h1> failed to render because authExpired was not defined in the template locals', created_at: new Date('2026-11-15T21:00:00Z'), resolved: true },
];

function renderStaff(data) {
  const file = path.join(ROOT, 'dashboard', 'views', 'staff.ejs');
  return ejs.render(fs.readFileSync(file, 'utf8'), {
    user: { username: 'tester' },
    section: 'errors',
    data,
    isStaff: true,
    inviteUrl: 'https://example.invalid/invite',
    saved: false,
  }, { filename: file });
}

const html = renderStaff({ errors: rows, filters: { level: '', command: '', shard: '' } });

check('view renders without throwing', typeof html === 'string' && html.length > 1000);
check('table has errors-table class + colgroup', /<table class="errors-table"><colgroup>/.test(html) && /<col class="c-when">/.test(html));
check('table wrapped in .table-scroll', /<div class="table-scroll">\s*<table class="errors-table">/.test(html));
check('WHEN is compact "YYYY-MM-DD HH:MM" + full timestamp in title',
  /<td class="when" title="Sun Nov 15 2026 23:31:11 GMT\+0000 \(Coordinated Universal Time\)">2026-11-15 23:31<\/td>/.test(html));
check('WHEN never contains the long Date.toString() as cell text', !/GMT\+0000 \(Coordinated Universal Time\)<\/td>/.test(html));
check('MESSAGE cell has title with full text + msg-text span (no 120-char slice)',
  /<td class="msg" title="TypeError \[ERR_INVALID_URL\]: Invalid URL at stream_from_info/.test(html) && /<span class="msg-text">TypeError/.test(html));
check('long message is NOT hard-truncated in the markup', html.includes('advanced to the next track in line.'));
check('resolved checkmark kept as separate element', /<span class="resolved-mark" title="Resolved">✅<\/span>/.test(html));
check('LEVEL error badge', /<span class="badge level-error">error<\/span>/.test(html));
check('LEVEL warn badge', /<span class="badge level-warn">warn<\/span>/.test(html));
check('LEVEL info badge', /<span class="badge level-info">info<\/span>/.test(html));
check('purge-selected button still disabled with nothing checked', /id="purge-selected-errors" disabled/.test(html));
check('purge hooks preserved (select-all, error-select, purge-result)',
  /id="select-all-errors"/.test(html) && /class="error-select"/.test(html) && /id="purge-result"/.test(html));
check('filter form has errors-filters class + shard field', /<form[^>]*class="errors-filters"/.test(html) && /<div class="f-shard">/.test(html));
check('Details links intact', /href="\/staff\/errors\/101">Details<\/a>/.test(html));

// Empty-state render
const empty = renderStaff({ errors: [], filters: { level: '', command: '', shard: '' } });
check('empty state renders', /No errors match/.test(empty));

// style.css rules
const css = fs.readFileSync(path.join(ROOT, 'dashboard', 'public', 'style.css'), 'utf8');
check('CSS: fixed table layout', /\.errors-table\{table-layout:fixed;width:100%\}/.test(css));
check('CSS: WHEN nowrap', /\.errors-table td\.when\{white-space:nowrap/.test(css));
check('CSS: message ellipsis', /\.errors-table td\.msg \.msg-text\{[^}]*text-overflow:ellipsis;white-space:nowrap/.test(css));
check('CSS: compact row padding + middle alignment', /\.errors-table th,\.errors-table td\{padding:6px 8px;vertical-align:middle\}/.test(css));
check('CSS: level badges (error red, warn amber)', /\.badge\.level-error\{[^}]*rgba\(237,66,69/.test(css) && /\.badge\.level-warn\{[^}]*rgba\(250,168,26/.test(css));
check('CSS: disabled buttons greyed + not-allowed', /\.btn:disabled,\.btn:disabled:hover\{opacity:.45;cursor:not-allowed/.test(css));
check('CSS: table-scroll overflow-x auto', /\.table-scroll\{overflow-x:auto/.test(css));
check('CSS: shard filter narrow (110px)', /\.errors-filters \.f-shard\{flex:0 0 110px\}/.test(css));
check('CSS: no other page styles touched (theme vars unchanged)', /--bg:#0f1115; --bg-2:#171a21;/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
