// Verify 1.15.21 — IPv4-first DNS set at the top of index.js.
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.21.js
const fs = require('fs');
const { execFileSync } = require('child_process');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) pass++; else fail++;
}

const src = fs.readFileSync('index.js', 'utf8');
const dnsIdx = src.indexOf("setDefaultResultOrder('ipv4first')");
const firstRequireIdx = src.indexOf("require('discord.js')");

check('setDefaultResultOrder(ipv4first) present in index.js', dnsIdx !== -1);
check('DNS line is before the first discord.js require', dnsIdx !== -1 && dnsIdx < firstRequireIdx);
check('DNS line is the first statement (line 1 is the comment, call within first 12 lines)',
  dnsIdx !== -1 && src.slice(0, dnsIdx).split('\n').length <= 12);

// Behavioral check in a FRESH node process: eval the exact DNS line taken
// from index.js, then assert the default order and that a localhost lookup
// (which resolves to both 127.0.0.1 and ::1) returns IPv4 first.
const dnsLine = src.split('\n').find((l) => l.includes('setDefaultResultOrder')).trim();
const childCode = `
const dns = require('node:dns');
${dnsLine}
if (dns.getDefaultResultOrder() !== 'ipv4first') { console.log('ORDER=' + dns.getDefaultResultOrder()); process.exit(2); }
dns.lookup('localhost', { all: true }, (err, addrs) => {
  if (err) { console.log('LOOKUP_ERR ' + err.code); process.exit(0); }
  console.log('ADDRS=' + JSON.stringify(addrs));
  const first = addrs && addrs[0];
  process.exit(first && first.family === 4 ? 0 : 3);
});
`;
let childOut = '';
let childCode0 = -1;
try {
  childOut = execFileSync(process.execPath, ['-e', childCode], { encoding: 'utf8', timeout: 15000 }).trim();
  childCode0 = 0;
} catch (e) {
  childOut = (e.stdout || '').toString().trim();
  childCode0 = e.status;
}
check('fresh process: default result order is ipv4first after the index.js line',
  childCode0 !== 2 && !childOut.includes('ORDER='), childOut.split('\n')[0] || '');
if (childOut.includes('LOOKUP_ERR')) {
  console.log('NOTE localhost lookup unavailable in this sandbox — ordering assertion is the meaningful check');
} else {
  check('fresh process: localhost lookup returns IPv4 first', childCode0 === 0, childOut);
}

// discord.com lookup is best-effort (sandbox may have no network): report only.
try {
  const out = execFileSync(process.execPath, ['-e', `
const dns = require('node:dns');
${dnsLine}
dns.lookup('discord.com', { all: true }, (err, addrs) => {
  if (err) { console.log('LOOKUP_ERR ' + err.code); process.exit(0); }
  console.log('ADDRS=' + JSON.stringify(addrs));
  process.exit(0);
});
`], { encoding: 'utf8', timeout: 15000 }).trim();
  console.log(`NOTE discord.com lookup: ${out}`);
} catch (e) {
  console.log(`NOTE discord.com lookup unavailable: ${(e.stdout || '').toString().trim() || e.message}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
