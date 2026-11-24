'use strict';
/* I2C sensors (first wave). Data only - no requires, so catalog.js can import it.
 *  - Arduino uses the standard libraries named in `arduino`.
 *  - MicroPython and Raspberry Pi use the register-level Python drivers below (written from the datasheets).
 *  - Computer targets simulate plausible values.
 * Output order of every driver == order of `outs`. Pressure is hPa, light is lux, accel is g, gyro is deg/s, temperature is C. */

const ADDR = (list) => list.map((a) => [a, a]);
const I2C = {
  bme280: { label: 'BME280', outs: [['tvar', 'temperature (C) into', 'temp'], ['hvar', 'humidity (%) into', 'hum'], ['pvar', 'pressure (hPa) into', 'pressure']], addrs: [['0x76', '0x76 (SDO to GND)'], ['0x77', '0x77 (SDO to 3V3)']], arduino: { include: 'Adafruit_BME280.h', lib: 'Adafruit BME280 Library' }, pyFn: 'bme280' },
  bmp280: { label: 'BMP280', outs: [['tvar', 'temperature (C) into', 'temp'], ['pvar', 'pressure (hPa) into', 'pressure']], addrs: [['0x76', '0x76 (SDO to GND)'], ['0x77', '0x77 (SDO to 3V3)']], arduino: { include: 'Adafruit_BMP280.h', lib: 'Adafruit BMP280 Library' }, pyFn: 'bmp280' },
  bh1750: { label: 'BH1750', outs: [['var', 'light (lux) into', 'lux']], addrs: [['0x23', '0x23 (ADDR to GND / open)'], ['0x5C', '0x5C (ADDR to 3V3)']], arduino: { include: 'BH1750.h', lib: 'BH1750 by Christopher Laws' }, pyFn: 'bh1750' },
  aht: { label: 'AHT10 / AHT20 / AHT21', outs: [['tvar', 'temperature (C) into', 'temp'], ['hvar', 'humidity (%) into', 'hum']], addrs: [['0x38', '0x38 (fixed)']], models: ['10', '20'], arduino: { include: 'Adafruit_AHTX0.h', lib: 'Adafruit AHTX0' }, pyFn: 'aht' },
  sht3x: { label: 'SHT30 / SHT31 / SHT35', outs: [['tvar', 'temperature (C) into', 'temp'], ['hvar', 'humidity (%) into', 'hum']], addrs: [['0x44', '0x44 (ADDR to GND)'], ['0x45', '0x45 (ADDR to 3V3)']], arduino: { include: 'Adafruit_SHT31.h', lib: 'Adafruit SHT31 Library' }, pyFn: 'sht3x' },
  htu21: { label: 'HTU21D / Si7021', outs: [['tvar', 'temperature (C) into', 'temp'], ['hvar', 'humidity (%) into', 'hum']], addrs: [['0x40', '0x40 (fixed)']], models: ['htu21d', 'si7021'], arduino: { include: null, lib: 'Adafruit HTU21DF Library (HTU21D) or Adafruit Si7021 Library' }, pyFn: 'htu21' },
  mcp9808: { label: 'MCP9808', outs: [['tvar', 'temperature (C) into', 'temp']], addrs: ADDR(['0x18', '0x19', '0x1A', '0x1B', '0x1C', '0x1D', '0x1E', '0x1F']), arduino: { include: 'Adafruit_MCP9808.h', lib: 'Adafruit MCP9808 Library' }, pyFn: 'mcp9808' },
  mpu6050: { label: 'MPU6050', outs: [['axvar', 'accel X (g) into', 'accel_x'], ['ayvar', 'accel Y (g) into', 'accel_y'], ['azvar', 'accel Z (g) into', 'accel_z'], ['gxvar', 'gyro X (deg/s) into', 'gyro_x'], ['gyvar', 'gyro Y (deg/s) into', 'gyro_y'], ['gzvar', 'gyro Z (deg/s) into', 'gyro_z'], ['tvar', 'chip temperature (C) into', 'chip_temp']], addrs: [['0x68', '0x68 (AD0 to GND)'], ['0x69', '0x69 (AD0 to 3V3)']], arduino: { include: 'Adafruit_MPU6050.h', lib: 'Adafruit MPU6050' }, pyFn: 'mpu6050' },
};

// ---------- Python drivers (MicroPython + Raspberry Pi). They need: i2c_w, i2c_r, i2c_wm, i2c_rm, time, NAN ----------
const COMMON = {
  crc: `def _crc8(b):
    c = 0xFF
    for x in b:
        c ^= x
        for _ in range(8):
            c = ((c << 1) ^ 0x31) & 0xFF if c & 0x80 else (c << 1) & 0xFF
    return c
`,
  bme: `_BME = {}

def _s16(v):
    return v - 65536 if v > 32767 else v

def _idiv(a, b):  # integer division that rounds toward zero, like C
    q = abs(a) // abs(b)
    return -q if (a < 0) != (b < 0) else q

def _bme_cal(addr, hum):
    d = i2c_rm(addr, 0x88, 24)
    c = {"T1": d[0] | (d[1] << 8), "P1": d[6] | (d[7] << 8)}
    for i, k in enumerate(("T2", "T3")):
        c[k] = _s16(d[2 + 2 * i] | (d[3 + 2 * i] << 8))
    for i in range(8):
        c["P%d" % (i + 2)] = _s16(d[8 + 2 * i] | (d[9 + 2 * i] << 8))
    if hum:
        c["H1"] = i2c_rm(addr, 0xA1, 1)[0]
        e = i2c_rm(addr, 0xE1, 7)
        c["H2"] = _s16(e[0] | (e[1] << 8))
        c["H3"] = e[2]
        h4 = (e[3] << 4) | (e[4] & 0x0F)
        h5 = (e[5] << 4) | (e[4] >> 4)
        c["H4"] = h4 - 4096 if h4 > 2047 else h4
        c["H5"] = h5 - 4096 if h5 > 2047 else h5
        c["H6"] = e[6] - 256 if e[6] > 127 else e[6]
    _BME[addr] = c

def _bme_comp(c, adc_t, adc_p, adc_h):
    v1 = (((adc_t >> 3) - (c["T1"] << 1)) * c["T2"]) >> 11
    v2 = (((((adc_t >> 4) - c["T1"]) * ((adc_t >> 4) - c["T1"])) >> 12) * c["T3"]) >> 14
    t_fine = v1 + v2
    temp = ((t_fine * 5 + 128) >> 8) / 100.0
    press = NAN
    p1 = t_fine - 128000
    p2 = p1 * p1 * c["P6"]
    p2 = p2 + ((p1 * c["P5"]) << 17)
    p2 = p2 + (c["P4"] << 35)
    p1 = ((p1 * p1 * c["P3"]) >> 8) + ((p1 * c["P2"]) << 12)
    p1 = (((1 << 47) + p1) * c["P1"]) >> 33
    if p1 != 0:
        p = 1048576 - adc_p
        p = _idiv(((p << 31) - p2) * 3125, p1)
        p1 = (c["P9"] * (p >> 13) * (p >> 13)) >> 25
        p2 = (c["P8"] * p) >> 19
        p = ((p + p1 + p2) >> 8) + (c["P7"] << 4)
        press = p / 256.0 / 100.0
    hum = NAN
    if adc_h is not None:
        x = t_fine - 76800
        x = (((((adc_h << 14) - (c["H4"] << 20) - (c["H5"] * x)) + 16384) >> 15) * (((((((x * c["H6"]) >> 10) * (((x * c["H3"]) >> 11) + 32768)) >> 10) + 2097152) * c["H2"] + 8192) >> 14))
        x = x - (((((x >> 15) * (x >> 15)) >> 7) * c["H1"]) >> 4)
        x = max(0, min(419430400, x))
        hum = (x >> 12) / 1024.0
    return temp, hum, press

def _bme_read(addr, hum):
    if addr not in _BME or (hum and "H1" not in _BME[addr]):
        _bme_cal(addr, hum)
    if hum:
        i2c_wm(addr, 0xF2, [0x01])  # humidity oversampling x1 (must be written before ctrl_meas)
    i2c_wm(addr, 0xF4, [0x25])      # temperature x1, pressure x1, forced (one-shot) mode
    time.sleep(0.03)
    d = i2c_rm(addr, 0xF7, 8 if hum else 6)
    adc_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
    adc_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
    adc_h = ((d[6] << 8) | d[7]) if hum else None
    return _bme_comp(_BME[addr], adc_t, adc_p, adc_h)
`,
};

const DRIVERS = {
  bme280: { needs: ['bme'], code: `def _drv_bme280(addr):
    try:
        t, h, p = _bme_read(addr, True)
        return t, h, p
    except Exception as e:
        print("BME280 error:", e)
        return NAN, NAN, NAN
` },
  bmp280: { needs: ['bme'], code: `def _drv_bmp280(addr):
    try:
        t, h, p = _bme_read(addr, False)
        return t, p
    except Exception as e:
        print("BMP280 error:", e)
        return NAN, NAN
` },
  bh1750: { needs: [], code: `def _drv_bh1750(addr):
    try:
        i2c_w(addr, [0x10])  # continuous high-resolution mode (1 lx)
        time.sleep(0.18)
        d = i2c_r(addr, 2)
        return (((d[0] << 8) | d[1]) / 1.2,)
    except Exception as e:
        print("BH1750 error:", e)
        return (NAN,)
` },
  aht: { needs: [], code: `_AHT = {}

def _drv_aht(addr, model):
    try:
        if addr not in _AHT:
            i2c_w(addr, [0xE1 if model == "10" else 0xBE, 0x08, 0x00])  # initialise / calibrate
            time.sleep(0.04)
            _AHT[addr] = True
        i2c_w(addr, [0xAC, 0x33, 0x00])  # trigger a measurement
        time.sleep(0.1)
        d = i2c_r(addr, 6)
        if d[0] & 0x80:  # still busy
            time.sleep(0.05)
            d = i2c_r(addr, 6)
        h = ((d[1] << 12) | (d[2] << 4) | (d[3] >> 4)) * 100.0 / 1048576
        t = (((d[3] & 0x0F) << 16) | (d[4] << 8) | d[5]) * 200.0 / 1048576 - 50
        return t, h
    except Exception as e:
        print("AHT error:", e)
        return NAN, NAN
` },
  sht3x: { needs: ['crc'], code: `def _drv_sht3x(addr):
    try:
        i2c_w(addr, [0x24, 0x00])  # single shot, high repeatability, no clock stretching
        time.sleep(0.02)
        d = i2c_r(addr, 6)
        if _crc8(d[0:2]) != d[2] or _crc8(d[3:5]) != d[5]:
            return NAN, NAN
        t = -45 + 175.0 * ((d[0] << 8) | d[1]) / 65535
        h = 100.0 * ((d[3] << 8) | d[4]) / 65535
        return t, h
    except Exception as e:
        print("SHT3x error:", e)
        return NAN, NAN
` },
  htu21: { needs: [], code: `def _drv_htu21(addr):
    try:
        i2c_w(addr, [0xF3])  # temperature, no-hold
        time.sleep(0.06)
        d = i2c_r(addr, 3)
        t = -46.85 + 175.72 * (((d[0] << 8) | (d[1] & 0xFC)) / 65536.0)
        i2c_w(addr, [0xF5])  # humidity, no-hold
        time.sleep(0.04)
        d = i2c_r(addr, 3)
        h = -6 + 125.0 * (((d[0] << 8) | (d[1] & 0xFC)) / 65536.0)
        return t, max(0.0, min(100.0, h))
    except Exception as e:
        print("HTU21/Si7021 error:", e)
        return NAN, NAN
` },
  mcp9808: { needs: [], code: `def _drv_mcp9808(addr):
    try:
        d = i2c_rm(addr, 0x05, 2)  # ambient temperature register
        up = d[0] & 0x1F
        t = (up & 0x0F) * 16 + d[1] / 16.0
        if up & 0x10:
            t -= 256
        return (t,)
    except Exception as e:
        print("MCP9808 error:", e)
        return (NAN,)
` },
  mpu6050: { needs: [], code: `def _drv_mpu6050(addr):
    try:
        i2c_wm(addr, 0x6B, [0])  # wake the chip up
        d = i2c_rm(addr, 0x3B, 14)
        def s(i):
            v = (d[i] << 8) | d[i + 1]
            return v - 65536 if v > 32767 else v
        return (s(0) / 16384.0, s(2) / 16384.0, s(4) / 16384.0, s(8) / 131.0, s(10) / 131.0, s(12) / 131.0, s(6) / 340.0 + 36.53)
    except Exception as e:
        print("MPU6050 error:", e)
        return (NAN,) * 7
` },
};

// plausible fake readings for the simulated computer targets (same order as outs)
const SIM_PY = {
  bme280: '(round(random.uniform(18, 28), 1), round(random.uniform(35, 65), 1), round(random.uniform(1000, 1025), 1))', bmp280: '(round(random.uniform(18, 28), 1), round(random.uniform(1000, 1025), 1))',
  bh1750: '(round(random.uniform(5, 900), 1),)', aht: '(round(random.uniform(18, 28), 1), round(random.uniform(35, 65), 1))', sht3x: '(round(random.uniform(18, 28), 1), round(random.uniform(35, 65), 1))', htu21: '(round(random.uniform(18, 28), 1), round(random.uniform(35, 65), 1))',
  mcp9808: '(round(random.uniform(18, 28), 2),)', mpu6050: '(round(random.uniform(-0.05, 0.05), 3), round(random.uniform(-0.05, 0.05), 3), round(random.uniform(0.95, 1.05), 3), round(random.uniform(-1, 1), 2), round(random.uniform(-1, 1), 2), round(random.uniform(-1, 1), 2), round(random.uniform(25, 35), 1))',
};
const SIM_JS = {
  bme280: '[r(18, 28, 1), r(35, 65, 1), r(1000, 1025, 1)]', bmp280: '[r(18, 28, 1), r(1000, 1025, 1)]', bh1750: '[r(5, 900, 1)]', aht: '[r(18, 28, 1), r(35, 65, 1)]', sht3x: '[r(18, 28, 1), r(35, 65, 1)]', htu21: '[r(18, 28, 1), r(35, 65, 1)]', mcp9808: '[r(18, 28, 2)]',
  mpu6050: '[r(-0.05, 0.05, 3), r(-0.05, 0.05, 3), r(0.95, 1.05, 3), r(-1, 1, 2), r(-1, 1, 2), r(-1, 1, 2), r(25, 35, 1)]',
};

/** Python source for the drivers of the given sensors (deduplicated, dependencies first). */
function pythonDrivers(sensors) {
  const need = new Set(); const parts = [];
  for (const s of sensors) for (const n of DRIVERS[s].needs) need.add(n);
  for (const n of need) parts.push(COMMON[n]);
  for (const s of sensors) parts.push(DRIVERS[s].code);
  return parts.join('\n');
}
module.exports = { I2C, DRIVERS, COMMON, SIM_PY, SIM_JS, pythonDrivers };
