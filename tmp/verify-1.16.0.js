// Verify 1.16.0: @discordjs/voice 0.18.0 -> 0.19.2 (DAVE support).
//
// BACKGROUND: /music join failed with "Could not join" — Discord closed the
// voice WebSocket with code 4017 ("E2EE/DAVE protocol required") because
// 0.18.0 never declares DAVE support in Identify. 0.19.2 sends
// max_dave_protocol_version in Identify (daveEncryption defaults to true)
// via @snazzah/davey. This script proves it LIVE: a local TLS WebSocket
// server plays the voice gateway and captures the real Identify payload
// from the real 0.19.2 Networking class. It also replays the 4017 close to
// prove the 1.15.40 close-code logger still hooks under 0.19.2.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.16.0.js
// (needs the self-signed cert in /tmp/dave-test-cert.pem + key — generated
// on first run by this script via openssl.)
'use strict';

const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const WebSocket = require('ws');
const { Networking } = require('@discordjs/voice');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CERT = '/tmp/dave-test-cert.pem';
const KEY = '/tmp/dave-test-key.pem';
let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function ensureCert() {
  if (!fs.existsSync(CERT) || !fs.existsSync(KEY)) {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${KEY} -out ${CERT} -days 1 -nodes -subj "/CN=127.0.0.1" 2>/dev/null`,
      { stdio: 'ignore' },
    );
  }
}

// A fake voice gateway: captures Identify, answers HELLO, then closes 4017.
function startFakeGateway() {
  return new Promise((resolve) => {
    ensureCert();
    const server = https.createServer({
      cert: fs.readFileSync(CERT),
      key: fs.readFileSync(KEY),
    });
    const wss = new WebSocket.Server({ server });
    let identify = null;
    let closedCode = null;
    const waiters = { identify: [], close: [] };
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        let pkt;
        try { pkt = JSON.parse(data.toString()); } catch { return; }
        if (pkt.op === 0 && !identify) {
          identify = pkt;
          waiters.identify.forEach((r) => r(pkt));
          // HELLO, like the real gateway.
          ws.send(JSON.stringify({ op: 8, d: { v: 4, heartbeat_interval: 13750 } }));
          // Then reject with 4017, like the real gateway did to 0.18.0.
          setTimeout(() => ws.close(4017, 'E2EE/DAVE protocol required'), 50);
        }
      });
      ws.on('close', (code) => {
        closedCode = code;
        waiters.close.forEach((r) => r(code));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        waitIdentify: () => new Promise((r) => {
          if (identify) return r(identify);
          waiters.identify.push(r);
        }),
        waitClose: () => new Promise((r) => {
          if (closedCode !== null) return r(closedCode);
          waiters.close.push(r);
        }),
        stop: () => new Promise((r) => { wss.close(() => server.close(r)); }),
      });
    });
  });
}

function makeNetworking(port, daveEncryption) {
  return new Networking(
    {
      endpoint: `127.0.0.1:${port}`,
      serverId: '1571439343976058970',
      token: 'fake-token-for-local-test-only',
      sessionId: 'fake-session-id',
      userId: '1571612707994472659',
      channelId: '1571757621503983749',
    },
    daveEncryption === undefined
      ? { debug: false }
      : { debug: false, daveEncryption },
  );
}

async function main() {
  const gw = await startFakeGateway();

  // Test 1: default options — DAVE on by default, Identify declares v1.
  const nw1 = makeNetworking(gw.port);
  const pkt1 = await gw.waitIdentify();
  ok('Identify op is 0', pkt1.op === 0);
  ok('Identify carries server_id', pkt1.d.server_id === '1571439343976058970');
  ok(
    'Identify max_dave_protocol_version is 1 (DAVE on by default)',
    pkt1.d.max_dave_protocol_version === 1,
  );
  // Test 2: the 1.15.40 close-code logger pattern still works under 0.19.2 —
  // a second 'close' listener on the Networking instance receives the code.
  const closeCodes = [];
  nw1.once('close', (code) => closeCodes.push(code));
  const serverClose = await gw.waitClose();
  await new Promise((r) => setTimeout(r, 200));
  ok('fake gateway closed with 4017', serverClose === 4017);
  ok(
    'Networking close listener receives code 4017 (1.15.40 logger still hooks)',
    closeCodes.length === 1 && closeCodes[0] === 4017,
  );
  nw1.destroy();

  // Test 3: daveEncryption:false sends 0 — the flag path is real, not a stub.
  const gw2 = await startFakeGateway();
  const nw2 = makeNetworking(gw2.port, false);
  const pkt2 = await gw2.waitIdentify();
  ok(
    'daveEncryption:false sends max_dave_protocol_version 0',
    pkt2.d.max_dave_protocol_version === 0,
  );
  nw2.destroy();
  await gw2.stop();
  await gw.stop();

  // Test 4: the bot's real musicQueue.js loads under @discordjs/voice 0.19.2.
  const mq = require('../src/utils/musicQueue');
  ok('musicQueue.js loads under 0.19.2', typeof mq === 'object');
  ok(
    'musicQueue exposes joinVoice/getQueue/destroyQueue',
    typeof mq.joinVoice === 'function'
      && typeof mq.getQueue === 'function'
      && typeof mq.destroyQueue === 'function',
  );

  // Test 5: installed versions are exactly what 1.16.0 promises.
  // (Read package.json files with fs — 0.19.2's exports map blocks
  // require('@discordjs/voice/package.json').)
  const readPkg = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const voicePkg = readPkg(path.join(__dirname, '..', 'node_modules', '@discordjs', 'voice', 'package.json'));
  const daveyPkg = readPkg(path.join(__dirname, '..', 'node_modules', '@snazzah', 'davey', 'package.json'));
  ok('@discordjs/voice is 0.19.2', voicePkg.version === '0.19.2');
  ok('@discordjs/voice requires Node >= 22.12.0', voicePkg.engines.node === '>=22.12.0');
  ok('@snazzah/davey is installed', /^0\.1\./.test(daveyPkg.version));
  ok('davey prebuilt linux binary present', fs.existsSync(
    path.join(__dirname, '..', 'node_modules', '@snazzah', 'davey-linux-x64-gnu', 'package.json'),
  ));
  const botPkg = require('../package.json');
  ok('bot package.json declares ^0.19.2', botPkg.dependencies['@discordjs/voice'] === '^0.19.2');
  ok('discord.js NOT bumped (stays 14.22.1)', botPkg.dependencies['discord.js'] === '^14.22.1');

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
