// Verify 1.16.7: error detail page shows context as readable JSON.
// Tests the formatErrorContext helper directly AND renders the real
// dashboard/views/staff.ejs error-detail section with the normalised
// value, the way the GET /staff/errors/:id route now passes it.
const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const { formatErrorContext } = require('../src/utils/formatErrorContext');

let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

const VIEWS = path.join(__dirname, '..', 'dashboard', 'views', 'staff.ejs');

function baseError(overrides = {}) {
  return {
    id: 215,
    level: 'error',
    shard_id: 0,
    guild_id: null,
    command_name: null,
    user_id: null,
    message: 'Uncaught exception: Unknown interaction',
    stack: 'DiscordAPIError[10062]: Unknown interaction',
    created_at: 'Wed Nov 18 2026 08:51:41 GMT+0000',
    resolved: 0,
    ...overrides,
  };
}

async function renderDetail(error) {
  // Mirror the route: normalise context, then render the real template.
  const row = { ...error, context: formatErrorContext(error.context) };
  return ejs.renderFile(VIEWS, {
    section: 'error-detail',
    data: { error: row },
    saved: false,
    isStaff: true,
    user: { username: 'tester', id: '1', avatar: null },
  });
}

(async () => {
  // --- helper unit cases -------------------------------------------------
  await check('object context pretty-prints with keys and values', () => {
    const out = formatErrorContext({ channelId: '123', customId: 'ticket-close' });
    assert.ok(out.includes('"channelId": "123"'), 'missing channelId');
    assert.ok(out.includes('"customId": "ticket-close"'), 'missing customId');
    assert.ok(out.includes('\n'), 'not pretty-printed');
    assert.ok(!out.includes('[object Object]'), 'still [object Object]');
  });

  await check('JSON string context is parsed and pretty-printed', () => {
    const out = formatErrorContext('{"channelId":"123","customId":"ticket-close"}');
    assert.ok(out.includes('"channelId": "123"'));
    assert.ok(out.includes('\n'));
    assert.ok(!out.includes('[object Object]'));
  });

  await check('plain string context passes through unchanged', () => {
    assert.strictEqual(formatErrorContext('something happened'), 'something happened');
  });

  await check('null context stays null (section hidden)', () => {
    assert.strictEqual(formatErrorContext(null), null);
    assert.strictEqual(formatErrorContext(undefined), null);
  });

  await check('empty string context stays null (section hidden)', () => {
    assert.strictEqual(formatErrorContext(''), null);
    assert.strictEqual(formatErrorContext('   '), null);
  });

  await check('malformed JSON string falls back to the raw string', () => {
    assert.strictEqual(formatErrorContext('{not json'), '{not json');
  });

  await check('nested object and array values render', () => {
    const out = formatErrorContext({ nested: { a: 1 }, list: [1, 2] });
    assert.ok(out.includes('"a": 1'));
    assert.ok(out.includes('"list": [\n    1,\n    2\n  ]'), 'array not pretty-printed');
    assert.ok(!out.includes('[object Object]'));
  });

  await check('empty object renders as {} (no [object Object])', () => {
    assert.strictEqual(formatErrorContext({}), '{}');
  });

  await check('number context stringifies', () => {
    assert.strictEqual(formatErrorContext(42), '42');
  });

  // --- real template renders ---------------------------------------------
  await check('template: object context shows keys/values, no [object Object]', async () => {
    const html = await renderDetail(baseError({ context: { channelId: '123', customId: 'ticket-close' } }));
    assert.ok(html.includes('Context'), 'no Context heading');
    assert.ok(html.includes('channelId'), 'channelId missing from page');
    assert.ok(html.includes('ticket-close'), 'customId missing from page');
    assert.ok(!html.includes('[object Object]'), 'page still shows [object Object]');
  });

  await check('template: JSON string context shows pretty JSON', async () => {
    const html = await renderDetail(baseError({ context: '{"channelId":"123"}' }));
    assert.ok(html.includes('channelId'));
    assert.ok(!html.includes('[object Object]'));
  });

  await check('template: plain string context shows raw text', async () => {
    const html = await renderDetail(baseError({ context: 'plain note' }));
    assert.ok(html.includes('plain note'));
  });

  await check('template: null context hides the Context section', async () => {
    const html = await renderDetail(baseError({ context: null }));
    assert.ok(!html.includes('<h2>Context</h2>'), 'Context heading shown for null');
    assert.ok(html.includes('Error #215'), 'page did not render');
  });

  await check('template: HTML in context is escaped, not injected', async () => {
    const html = await renderDetail(baseError({ context: { note: '<script>alert(1)</script>' } }));
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag in output');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped script missing');
  });

  // --- source checks -------------------------------------------------------
  await check('source: error-detail route normalises context via the helper', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
    assert.ok(src.includes("require('./utils/formatErrorContext')"), 'helper not required');
    assert.ok(src.includes('row.context = formatErrorContext(row.context)'), 'route does not normalise');
  });

  await check('source: template still renders data.error.context (dumb template)', () => {
    const tpl = fs.readFileSync(VIEWS, 'utf8');
    assert.ok(tpl.includes('<%= data.error.context %>'), 'template context line changed');
  });

  await check('source: no other view renders a .context value raw', () => {
    const viewsDir = path.join(__dirname, '..', 'dashboard', 'views');
    for (const file of fs.readdirSync(viewsDir)) {
      if (!file.endsWith('.ejs')) continue;
      const text = fs.readFileSync(path.join(viewsDir, file), 'utf8');
      const hits = text.split('\n').filter((l) => l.includes('.context') && l.includes('<%='));
      if (file === 'staff.ejs') {
        assert.strictEqual(hits.length, 1, `staff.ejs should have exactly one context render, found ${hits.length}`);
      } else {
        assert.strictEqual(hits.length, 0, `${file} renders .context raw`);
      }
    }
  });

  await check('source: no slash command file references the helper', () => {
    const cmds = path.join(__dirname, '..', 'src', 'commands');
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.js') && fs.readFileSync(p, 'utf8').includes('formatErrorContext')) found.push(p);
      }
    };
    walk(cmds);
    assert.deepStrictEqual(found, []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:', failures.join(', '));
    process.exit(1);
  }
})();
