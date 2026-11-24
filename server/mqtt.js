'use strict';
// Built-in MQTT broker. ESP boards connect with username = device token.
//   publish   tronic/<token>/data   {"temp":24.1,"hum":55}
//   subscribe tronic/<token>/cmd    receives {"id":1,"name":"led","value":"1"}
const net = require('net');
const { get } = require('./db');
const services = require('./services');

async function startMqtt(port) {
  const { Aedes } = await import('aedes');
  const aedes = await Aedes.createBroker();
  const online = new Map(); // token -> client

  aedes.authenticate = (client, username, password, cb) => {
    const token = username || '';
    const dev = token ? get('SELECT * FROM devices WHERE token = ?', token) : null;
    if (!dev) { const e = new Error('bad device token'); e.returnCode = 4; return cb(e, false); }
    client.deviceToken = token; client.deviceId = dev.id;
    cb(null, true);
  };
  aedes.authorizePublish = (client, packet, cb) => {
    if (!client) return cb(null);
    if (packet.topic === `tronic/${client.deviceToken}/data`) return cb(null);
    cb(new Error('publish only to tronic/<your-token>/data'));
  };
  aedes.authorizeSubscribe = (client, sub, cb) => {
    if (sub.topic === `tronic/${client.deviceToken}/cmd`) return cb(null, sub);
    cb(new Error('subscribe only to tronic/<your-token>/cmd'));
  };

  aedes.on('publish', (packet, client) => {
    if (!client || !packet.topic.endsWith('/data')) return;
    const dev = get('SELECT * FROM devices WHERE id = ?', client.deviceId); if (!dev) return;
    try { services.ingest(dev, JSON.parse(packet.payload.toString()), 'mqtt'); } catch (e) { /* bad payload from device: ignore */ }
  });
  aedes.on('client', (client) => {
    online.set(client.deviceToken, client);
    const dev = get('SELECT * FROM devices WHERE id = ?', client.deviceId);
    if (dev) { // flush commands queued while it was offline, once it subscribes
      setTimeout(() => { for (const c of services.takePendingCommands(dev)) aedes.publish({ topic: `tronic/${dev.token}/cmd`, payload: JSON.stringify(c), qos: 0, retain: false, cmd: 'publish', dup: false }, () => {}); }, 1500);
    }
  });
  aedes.on('clientDisconnect', (client) => { if (online.get(client.deviceToken) === client) online.delete(client.deviceToken); });

  services.hooks.mqttDeliver = (device, cmd) => {
    if (!online.has(device.token)) return false;
    aedes.publish({ topic: `tronic/${device.token}/cmd`, payload: JSON.stringify(cmd), qos: 0, retain: false, cmd: 'publish', dup: false }, () => {});
    return true;
  };

  const server = net.createServer(aedes.handle);
  await new Promise((resolve) => {
    server.once('error', (e) => { console.warn(`[mqtt] disabled: ${e.code || e.message} (port ${port}). HTTP ingest still works.`); resolve(); });
    server.listen(port, () => { console.log(`[mqtt] broker listening on :${port}`); resolve(); });
  });
  return { aedes, server };
}
module.exports = { startMqtt };
