'use strict';
// Fake ESP32 for demos/testing:  node tools/simulate.js <device-token> [server-url] [interval-ms]
// Sends temp / hum / light / fan every few seconds and obeys "fan" and "led" commands from the dashboard.
const [token, server = 'http://localhost:3000', every = '2000'] = process.argv.slice(2);
if (!token) { console.error('Usage: node tools/simulate.js <device-token> [server-url] [interval-ms]'); process.exit(1); }
let t = 0, fan = 0, led = 0;
const H = { 'content-type': 'application/json', 'x-device-token': token };
async function tick() {
  t++;
  const temp = +(24 + 5 * Math.sin(t / 20) + (Math.random() - 0.5) * 0.8 + (fan ? -2 : 0)).toFixed(2);
  const hum = +(60 - (temp - 24) * 2 + (Math.random() - 0.5) * 2).toFixed(1);
  const spike = t % 60 === 0; // occasional fault so ML anomaly detection has something to catch
  const body = { temp: spike ? temp + 25 : temp, hum, light: Math.round(500 + 300 * Math.sin(t / 30) + Math.random() * 20), fan, led };
  try {
    const r = await fetch(server + '/api/ingest', { method: 'POST', headers: H, body: JSON.stringify(body) });
    console.log(r.status, JSON.stringify(body));
    const c = await (await fetch(server + '/api/device/commands', { headers: H })).json();
    for (const cmd of c.commands || []) { console.log('  <- command', cmd.name, cmd.value); if (cmd.name === 'fan') fan = +cmd.value; if (cmd.name === 'led') led = +cmd.value; }
  } catch (e) { console.error('error:', e.message); }
}
setInterval(tick, +every); tick();
