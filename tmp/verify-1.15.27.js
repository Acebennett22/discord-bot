// Verify 1.15.27: configurable ticket panel button label.
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.27.js
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); }
}
function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

const tickets = require('../src/utils/tickets');
const { DEFAULT_TICKET_BUTTON_LABEL, validateTicketButtonLabel, resolveTicketButtonLabel, ticketPanelRow, ticketPanelEmbed } = tickets;

// --- Validation ---
check('validate: empty string is valid (reset to default)', validateTicketButtonLabel('') === null);
check('validate: whitespace-only is valid (reset to default)', validateTicketButtonLabel('   ') === null);
check('validate: null/undefined is valid', validateTicketButtonLabel(null) === null && validateTicketButtonLabel(undefined) === null);
check('validate: short custom label is valid', validateTicketButtonLabel('Send a Raven') === null);
check('validate: exactly 80 chars is valid', validateTicketButtonLabel('x'.repeat(80)) === null);
check('validate: 81 chars is rejected', typeof validateTicketButtonLabel('x'.repeat(81)) === 'string');
check('validate: rejection message mentions 80', (validateTicketButtonLabel('x'.repeat(81)) || '').includes('80'));

// --- Resolve ---
check('resolve: undefined settings -> default', resolveTicketButtonLabel(undefined) === 'Create Ticket');
check('resolve: empty settings -> default', resolveTicketButtonLabel({}) === 'Create Ticket');
check('resolve: empty string -> default', resolveTicketButtonLabel({ ticketButtonLabel: '' }) === 'Create Ticket');
check('resolve: whitespace-only -> default', resolveTicketButtonLabel({ ticketButtonLabel: '   ' }) === 'Create Ticket');
check('resolve: custom label passes through', resolveTicketButtonLabel({ ticketButtonLabel: 'Send a Raven' }) === 'Send a Raven');
check('resolve: custom label is trimmed', resolveTicketButtonLabel({ ticketButtonLabel: '  Send a Raven  ' }) === 'Send a Raven');
check('resolve: default constant is Create Ticket', DEFAULT_TICKET_BUTTON_LABEL === 'Create Ticket');

// --- Panel row builder ---
function rowLabel(row) {
  const json = row.toJSON();
  return json.components[0].label;
}
check('row: default label when no label given', rowLabel(ticketPanelRow()) === 'Create Ticket');
check('row: default label when label is empty', rowLabel(ticketPanelRow(null, '')) === 'Create Ticket');
check('row: custom label used', rowLabel(ticketPanelRow(null, 'Send a Raven')) === 'Send a Raven');
check('row: panel id in custom_id with custom label', ticketPanelRow(42, 'Send a Raven').toJSON().components[0].custom_id === 'ticket_create:42');
check('row: emoji + style unchanged', (() => { const c = ticketPanelRow(null, 'X').toJSON().components[0]; return c.emoji.name === '🎫' && c.style === 1; })());

// --- Panel embed builder ---
function embedDesc(embed) { return embed.toJSON().description; }
check('embed: default description names the default button', embedDesc(ticketPanelEmbed()).includes('Click **Create Ticket** below'));
check('embed: default description names the custom button', embedDesc(ticketPanelEmbed(null, null, 'Send a Raven')).includes('Click **Send a Raven** below'));
check('embed: custom description is untouched by the label', embedDesc(ticketPanelEmbed('T', 'Custom words', 'Send a Raven')) === 'Custom words');
check('embed: title still defaults', ticketPanelEmbed(null, null, 'Send a Raven').toJSON().title === '🎫 Support Tickets');

// --- guildSettings storage: stub the db layer and exercise the real code ---
const db = require('../src/utils/database');
const origIsEnabled = db.isEnabled;
const origQuery = db.query;
let captured = null;
db.isEnabled = () => true;
db.query = async (sql, params) => { captured = { sql, params }; return []; };
const gs = require('../src/utils/guildSettings');

(async () => {
  // Save with a custom label: the value must reach the DB params, and the
  // positional COLUMNS/values lists must stay in sync (guard throws otherwise).
  let saved;
  try {
    const r = await gs.setGuildSettings('guild-verify-1', { ticketButtonLabel: 'Send a Raven' });
    saved = r.saved;
  } catch (e) { saved = false; check('settings: setGuildSettings does not throw (COLUMNS/values in sync)', false, e.message); }
  check('settings: setGuildSettings reports saved', saved === true);
  check('settings: custom label is the last bound param', captured && captured.params[captured.params.length - 1] === 'Send a Raven', JSON.stringify(captured && captured.params.slice(-3)));
  check('settings: INSERT lists ticket_button_label column', captured && captured.sql.includes('ticket_button_label'));
  check('settings: param count matches columns + guild_id', (() => {
    // COLUMNS is not exported; count columns in the INSERT list.
    const cols = captured.sql.match(/INSERT INTO guild_settings \(guild_id, ([^)]+)\)/)[1].split(',').length;
    return captured.params.length === cols + 1;
  })(), `params=${captured && captured.params.length}`);

  // Save with an empty label: stores NULL (default at read time).
  captured = null;
  await gs.setGuildSettings('guild-verify-2', { ticketButtonLabel: '' });
  check('settings: empty label stores NULL', captured && captured.params[captured.params.length - 1] === null);

  // Load: a row carrying the column maps through; NULL maps to '' (default).
  db.query = async () => [{ ticket_button_label: 'Send a Raven' }];
  gs.invalidate('guild-verify-3');
  const loaded = await gs.getGuildSettings('guild-verify-3');
  check('settings: load maps ticket_button_label', loaded.ticketButtonLabel === 'Send a Raven');
  db.query = async () => [{ ticket_button_label: null }];
  gs.invalidate('guild-verify-4');
  const loadedNull = await gs.getGuildSettings('guild-verify-4');
  check('settings: NULL column loads as empty (default label)', loadedNull.ticketButtonLabel === '');
  check('settings: DEFAULTS carries ticketButtonLabel', gs.DEFAULTS.ticketButtonLabel === '');

  db.isEnabled = origIsEnabled;
  db.query = origQuery;

  // --- Source checks: wiring ---
  const dash = read('src/dashboard.js');
  check('dashboard: settings POST validates ticketButtonLabel', dash.includes("'ticketButtonLabel' in body") && dash.includes('validateTicketButtonLabel'));
  check('dashboard: settings POST trims + patches the label', dash.includes("patch.ticketButtonLabel = String(body.ticketButtonLabel ?? '').trim();"));
  check('dashboard: ticket-panels route resolves the stored label', dash.includes('resolveTicketButtonLabel(await getGuildSettings(req.params.id))'));
  check('dashboard: no hardcoded label left in ticket-panels route', !dash.includes("label: 'Create Ticket'"));
  check('commands: /ticket-setup passes the stored label', read('src/commands/tickets/ticket-setup.js').includes('resolveTicketButtonLabel(await getGuildSettings(interaction.guildId))'));
  check('commands: /ticket-panel create passes the stored label', read('src/commands/tickets/ticket-panel.js').includes('resolveTicketButtonLabel(await getGuildSettings(interaction.guildId))'));
  const ejs = read('dashboard/views/settings.ejs');
  check('ejs: ticket button label field in Tickets form', ejs.includes('name="ticketButtonLabel"'));
  check('ejs: field capped at 80 chars', ejs.split('\n').some((l) => l.includes('name="ticketButtonLabel"') && l.includes('maxlength="80"')));
  check('ejs: field shows the current value', ejs.includes('value="<%= settings.ticketButtonLabel || \'\' %>"'));
  check('ejs: form notes already-posted panels keep their old label', ejs.includes('already-posted panels keep their old label'));
  check('db: self-heal adds guild_settings.ticket_button_label', read('src/utils/database.js').includes("['guild_settings', 'ticket_button_label', 'VARCHAR(80) NULL']"));
  check('schema: guild_settings CREATE TABLE has the column', read('sql/schema.sql').includes('ticket_button_label VARCHAR(80) NULL'));
  check('schema: no hardcoded label build site remains', !/setLabel\('Create Ticket'\)/.test(read('src/utils/tickets.js')));
  const pkg = JSON.parse(read('package.json'));
  check('version: package.json is 1.15.27', pkg.version === '1.15.27');
  check('changelog: 1.15.27 entry exists', read('CHANGELOG.md').includes('## [1.15.27]'));

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
