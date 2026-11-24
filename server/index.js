'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const routes = require('./routes');
const services = require('./services');
const { startMqtt } = require('./mqtt');

const PORT = +process.env.PORT || 3000;
const MQTT_PORT = +process.env.MQTT_PORT || 1883;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY ? 1 : false);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api|ws).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  const status = err.status || 500; if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const server = http.createServer(app);
services.attachWebSocket(server);
server.listen(PORT, async () => {
  console.log(`\n  TronicIOT running  ->  http://localhost:${PORT}\n`);
  try { await startMqtt(MQTT_PORT); } catch (e) { console.warn('[mqtt] failed to start:', e.message); }
});
process.on('unhandledRejection', (e) => console.error('unhandled', e));
