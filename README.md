# TronicIOT

**IoT dashboards + cloud machine learning for makers.** Users register, log in, connect their own
ESP32 / ESP8266 / Arduino / Pico W / Raspberry Pi, build a live dashboard, control hardware, and
train & run ML models **on our server** - no Raspberry Pi / Jetson needed on the device side.

## Run it

Requires **Node.js 22.5+** (uses the built-in SQLite - no native build tools needed).

```bash
npm install
npm start
```

Open <http://localhost:3000>, create an account, add a device, copy the generated code to your board.

| Setting | Env var | Default |
|---|---|---|
| Web/API port | `PORT` | 3000 |
| MQTT broker port | `MQTT_PORT` | 1883 |
| Data folder (SQLite DB + JWT secret) | `DATA_DIR` | `./data` |
| Fixed JWT secret (recommended in production) | `JWT_SECRET` | auto-generated in `data/.jwt_secret` |
| Behind a reverse proxy (HTTPS) | `TRUST_PROXY=1` | off |

Try it without hardware: add a device in the UI, then `npm run simulate -- <device-token>`.
Run the end-to-end test-suite: `npm test` (starts an isolated server with a temp database).

## Features

- **Accounts** - register / login (bcrypt + JWT), change password, per-user data isolation, rate limiting.
- **Devices** - unlimited-ish (50/user) boards, secret token per device, online/offline status, CSV export.
- **Connectivity** - HTTP `POST /api/ingest` (also `GET` for tiny clients) and a built-in **MQTT broker**.
  Ready-to-paste code (token pre-filled) for ESP32, ESP8266, Pico W (MicroPython), Python, curl; plus `firmware/`.
- **Dashboards** - multiple per user; widgets: value, gauge, live line chart, live bar chart, switch,
  slider, device status, ML output, live log. Real-time via WebSocket.
- **Remote control** - switches/sliders/"send command" queue commands; boards get them instantly over MQTT or by polling `/api/device/commands`.
- **Cloud ML (the "no Raspberry Pi" part)** - train from a device's stored data or an uploaded CSV:
  linear regression, classifier, KNN, K-means, anomaly detection, time-series forecast.
  Run them via `POST /api/ml/models/:id/predict` (from the board or anywhere), or turn on **Auto-run** so every
  new reading is scored live (anomalies raise alerts). Models export as JSON to run on-device later.
- **Visual builder (drag & drop -> code)** - snap blocks together (sensors, outputs, if/else with AND/OR, calculate, scale/map a value, repeat N times, uptime, comments, wait, send to dashboard, cloud ML call, "when command received") and get complete, ready-to-flash code that updates live. Targets: ESP32 / ESP8266 / Pico W in **Arduino C++** and **MicroPython**, Raspberry Pi in **Python**, plus computer-simulated **Python** and **Node.js** for testing without hardware. Pins are checked per board (ADC rules, input-only pins, active-low LEDs), unsafe/invalid programs get a red error on the exact block instead of broken code, and starter templates are included. Projects are saved to your account; Wi-Fi passwords never leave the browser except to fill the generated code.
- **My Kit (pick your board and parts)** - a library of 46 boards and 440 parts (sensors, modules, motor drivers, relays, displays, GPS, radios, tools...) from your lists. Users tick what they own; the Playground then shows only blocks for those parts, grouped by category. Users can also **create their own part** (analog sensor with a formula, on/off sensor, switch, dimmer) and it becomes a block. Each part has a status: **Ready** (code is generated and tested), **Coming soon** (I2C / SPI / UART / pulse modules that need protocol libraries), or **Checklist only** (tools and passive components).
- **Friendly for every age** - plain wording ("My Boards", "Playground", "Smart Models"), a getting-started checklist, big tappable cards, a Simple/All blocks switch, light and dark themes, adjustable text size, keyboard focus outlines and a phone layout.
- **Automation** - rules ("temp > 30 -> alert + send `fan=1`") and an alerts feed.

## Project layout

```
server/   builder/ (block catalog, validator, 4 code generators)
          index.js (app) - routes.js (REST API) - services.js (ingest, realtime, rules, auto-ML)
          mqtt.js (broker) - ml.js (ML engine) - db.js (SQLite) - auth.js - selftest.js
public/   single-page app (index.html, style.css, core.js, widgets.js, views.js, views2.js, builder.js, app.js)
firmware/ ESP32 HTTP / MQTT / ML-predict sketches, Pico W MicroPython
tools/    simulate.js (fake device)
```

## API summary

Device auth: header `X-Device-Token: <token>` (or `Authorization: Bearer <token>`).
User auth: `Authorization: Bearer <jwt>` from `POST /api/auth/login`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register`, `/login` | - | create account / sign in |
| `POST /api/ingest` | device | send readings `{"temp":24.5}` |
| `GET /api/device/commands` | device | fetch pending commands |
| `POST /api/ml/models/:id/predict` | device or user | run a trained model `{"inputs":{...}}` |
| `/api/devices`, `/api/dashboards`, `/api/ml/models`, `/api/rules`, `/api/alerts` | user | management (CRUD) |

MQTT: user = device token; publish `tronic/<token>/data`, subscribe `tronic/<token>/cmd`.

## Deploying for real users

1. Run on a VPS (or any host) with `JWT_SECRET` set and a reverse proxy (Caddy / nginx) providing **HTTPS**; set `TRUST_PROXY=1`.
2. Open port 1883 only if you want MQTT. The broker authenticates every client by device token and restricts each
   device to its own two topics, but traffic is plain MQTT unless you add TLS in front (e.g. stunnel / nginx stream).
3. Back up the `data/` folder (SQLite). For many users / heavy load, move to PostgreSQL + a worker queue for ML training.

## Parts library

Data lives in `server/builder/library-data.js` (boards, categories, part names) and `server/builder/library.js` (which parts are Ready and how they work).
A Ready part is a **recipe** that expands into the already-tested primitive blocks (read analog, read digital, calculate, write pin, ...), so every generator keeps working and every part is covered by `npm run test:library`
(recipe maths, every part on every compatible target, and generated code run for real).
To make a new part Ready, add one line to the `READY` table in `library.js`, for example `'MQ-2': an('gas', 'hint text')` or `'PIR': di('motion', 'high', 'none', 'hint')`.
Parts that talk SPI, UART or count pulses (GPS modules, OLED displays, LoRa, servo, stepper, most other I2C chips...) are listed as "Coming soon": they need real library code per language, which should be verified on hardware before it is offered.

## I2C sensors (beta)

13 popular I2C parts are available as blocks: BME280, BMP280, BH1750, AHT10/20/21, SHT30/31/35, HTU21D, Si7021, MCP9808 and MPU6050.
They use the board's fixed I2C pins (shown in the Wiring tab and protected from other uses). **Arduino** uses the standard Adafruit / BH1750 libraries (the "How to run it" tab lists them);
**MicroPython** and **Raspberry Pi** use small register-level drivers written from the datasheets (`server/builder/i2c-sensors.js`); computer targets simulate plausible values.
They are labelled **Beta** because they were verified with simulated chips and published test vectors (Bosch BMP280 datasheet example, Sensirion CRC example) - not yet on real hardware.
Run `npm run test:i2c`. If you try one on a real board, a result either way is valuable.

## How the builder's code is verified

`npm test` generates code for every template on every target (72 combinations) and then **actually runs** the generated
Python, Node.js and MicroPython programs against a live server: sensor data arrives, a cloud ML prediction is made,
and dashboard commands drive the outputs. MicroPython is executed on desktop Python with fake `machine`/`network` modules
(`server/test-shims`) because no board is attached. **Arduino C++ output is only structurally checked** (balanced braces,
declared variables) because no C++ toolchain is installed in the test environment - compile it once in the Arduino IDE
with the libraries listed in the "How to run it" tab, and report any compiler message so the generator can be fixed.

## Known limits (honest list)

- Builder targets cover the boards above. Boards without Wi-Fi (Arduino Uno/Mega, STM32 without a modem) are not included; adding a board = one entry in `server/builder/catalog.js` (+ a generator for a new language).

- ML runs in-process on the server (fine for thousands of rows per model; very large datasets should move to a worker).
- No email verification / password reset yet (needs an SMTP provider).
- Widgets are not drag-and-drop re-orderable yet.
- Uploading arbitrary user code or ONNX/TensorFlow models is intentionally not included (security: needs sandboxing).

## Docker

```bash
cp .env.example .env            # set JWT_SECRET
docker compose up -d --build    # http://localhost:3000, MQTT on 1883
```

HTTPS with an automatic Let's Encrypt certificate (DOMAIN's DNS must point at the server, ports 80/443 open;
keep `TRUST_PROXY=1` in `.env`):

```bash
docker compose --profile https up -d --build
```

Data (SQLite) lives in the `tronic-data` volume. Back it up with
`docker run --rm -v tronic-data:/d -v "$PWD":/b alpine tar czf /b/tronic-backup.tgz -C /d .`
