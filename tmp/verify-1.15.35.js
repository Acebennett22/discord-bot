// Verify 1.15.35: reaction-role list shows channel name, role name, emoji.
// Renders the real settings.ejs (module='reactionroles') with sample locals
// and asserts on the rendered mapping rows.
const path = require('node:path');
const ejs = require('ejs');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const TEMPLATE = path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs');

function baseLocals(overrides = {}) {
  return {
    guild: { id: '1571439343976058970', name: "THE VIKING'S LONGHOUSE", icon: null },
    saved: false,
    module: 'reactionroles',
    settings: {},
    channels: [
      { id: '111', name: 'choose-your-rank', type: 0 },
      { id: '222', name: 'general', type: 0 },
    ],
    roles: [
      { id: '333', name: 'PC Warrior' },
      { id: '444', name: 'Xbox Warrior' },
    ],
    reactionRoleMappings: [],
    emojis: [],
    ...overrides,
  };
}

const MAPPINGS = [
  { id: 1, message_id: '999', channel_id: '111', emoji: '💻', role_id: '333', required_role_id: null, min_days_in_server: null, min_level: null },
  { id: 2, message_id: '999', channel_id: '111', emoji: '🟢', role_id: '444', required_role_id: '555', min_days_in_server: 7, min_level: 2 },
  // Channel + role both missing from the guild lists -> fallbacks.
  { id: 3, message_id: '999', channel_id: '000-missing', emoji: '🔵', role_id: '000-missing-role', required_role_id: null, min_days_in_server: null, min_level: null },
];

// The display line of each mapping card: the text before its Remove button.
function displayLines(html) {
  return html.split('<div class="card card-block"').slice(1).map((chunk) => chunk.split('<button')[0]);
}

async function main() {
  console.log('== render with 3 mappings ==');
  const html = await ejs.renderFile(TEMPLATE, baseLocals({ reactionRoleMappings: MAPPINGS }));
  const lines = displayLines(html);
  check('three mapping cards rendered', lines.length === 3, `got ${lines.length}`);

  check('row 1 shows channel, role, emoji', lines[0] && lines[0].includes('#choose-your-rank') && lines[0].includes('PC Warrior') && lines[0].includes('💻'), lines[0]?.trim());
  check('row 1 exact format "#choose-your-rank · PC Warrior · 💻"', lines[0] && lines[0].includes('#choose-your-rank · PC Warrior · 💻'), lines[0]?.trim());
  check('row 2 shows channel, role, emoji', lines[1] && lines[1].includes('#choose-your-rank') && lines[1].includes('Xbox Warrior') && lines[1].includes('🟢'), lines[1]?.trim());

  for (let i = 0; i < lines.length; i++) {
    check(`row ${i + 1}: no <@& mention syntax in display line`, !lines[i].includes('<@&'));
    check(`row ${i + 1}: no message ID in display line`, !lines[i].includes('999'));
    check(`row ${i + 1}: no "message" label in display line`, !/message/i.test(lines[i]));
  }
  // 1.15.36: the message ID now appears in the per-message-group Refresh
  // headers only (once as text + once in the button's data-rr-message per
  // group — the fixture has 2 groups sharing message 999, so 4 hits) — and
  // never in a mapping row's display line (checked per-row above).
  check('message ID appears only in group Refresh headers, never in a mapping row',
    (html.match(/999/g) || []).length === 4
    && (html.match(/data-rr-message="999"/g) || []).length === 2
    && (html.match(/message <code>999<\/code>/g) || []).length === 2);

  check('row 3: channel fallback is #<channel_id>', lines[2] && lines[2].includes('#000-missing'), lines[2]?.trim());
  check('row 3: role fallback is raw role id', lines[2] && lines[2].includes('000-missing-role'), lines[2]?.trim());
  check('row 3 exact format "#000-missing · 000-missing-role · 🔵"', lines[2] && lines[2].includes('#000-missing · 000-missing-role · 🔵'), lines[2]?.trim());

  check('per-row Remove button present', html.includes('data-remove-reaction-role="1"') && html.includes('data-remove-reaction-role="2"') && html.includes('data-remove-reaction-role="3"'));
  check('per-row checkbox present', html.includes('class="rr-select" value="1"') && html.includes('class="rr-select" value="2"') && html.includes('class="rr-select" value="3"'));
  check('Requirements line still present per row', (html.match(/Requirements:/g) || []).length === 3);
  check('Requirements content unchanged (row 2 keeps required-role detail)', html.includes('needs &lt;@&amp;555&gt;') && html.includes('7d+ in server') && html.includes('level 2+'));
  check('Requirements "none" for rows without requirements', (html.match(/Requirements: none/g) || []).length === 2);

  check('bulk controls present', html.includes('id="rr-select-all"') && html.includes('id="rr-remove-selected"'));
  check('add form untouched', html.includes('id="add-reaction-role-form"') && html.includes('id="rr-rows"'));

  console.log('== render with no mappings ==');
  const empty = await ejs.renderFile(TEMPLATE, baseLocals({ reactionRoleMappings: [] }));
  check('empty state shown', empty.includes('No reaction-role mappings yet.'));
  check('empty state: no mapping cards', !empty.includes('<div class="card card-block"'));
  check('empty state: bulk controls absent', !empty.includes('id="rr-select-all"'));
  check('empty state: add form still present', empty.includes('id="add-reaction-role-form"'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error('RENDER ERROR:', err.message); process.exit(1); });
