// Built-in slash command names (scanned from src/commands/*/*.js).
// Used by /custom-add to refuse triggers that would collide with a
// built-in command. Cached after the first scan.
const fs = require('fs');
const path = require('path');

let cached = null;

function getCommandNames() {
  if (cached) return cached;
  const names = new Set();
  const base = path.join(__dirname, '..', 'commands');
  try {
    for (const folder of fs.readdirSync(base)) {
      const dir = path.join(base, folder);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
        names.add(file.replace('.js', ''));
      }
    }
  } catch {}
  cached = names;
  return names;
}

module.exports = { getCommandNames };
