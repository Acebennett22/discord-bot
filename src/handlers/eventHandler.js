// Auto-loads every event file under src/events/**.
// Each event exports { name, once?, execute }.
const fs = require('fs');
const path = require('path');

function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');
  const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  let count = 0;
  for (const file of files) {
    const exported = require(path.join(eventsPath, file));
    const events = Array.isArray(exported) ? exported : [exported];
    for (const event of events) {
      if (!event?.name || typeof event.execute !== 'function') {
        console.warn(`[events] Skipping ${file}: missing name or execute().`);
        continue;
      }
      if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
      else client.on(event.name, (...args) => event.execute(...args, client));
      count++;
    }
  }
  console.log(`[events] Loaded ${count} events.`);
}

module.exports = { loadEvents };
