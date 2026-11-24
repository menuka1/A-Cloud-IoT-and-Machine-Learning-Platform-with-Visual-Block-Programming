'use strict';
/* Parts & boards library (data only). Recipes live in recipes.js.
 * Tiers:  ready = blocks generate verified code today | soon = needs a protocol library (I2C/SPI/UART/pulse) | info = tool / passive component (inventory only) */

const L = (s) => s.trim().split('\n').map((x) => x.trim()).filter(Boolean);

const CATEGORIES = [
  { id: 'temp', label: 'Temperature & Humidity', emoji: '🌡️' },
  { id: 'distance', label: 'Distance & Proximity', emoji: '📏' },
  { id: 'imu', label: 'Motion & Orientation (IMU)', emoji: '🧭' },
  { id: 'gas', label: 'Gas & Air Quality', emoji: '🌫️' },
  { id: 'light', label: 'Light & Color', emoji: '💡' },
  { id: 'water', label: 'Water & Farming', emoji: '🌱' },
  { id: 'gps', label: 'GPS & Location', emoji: '🛰️' },
  { id: 'comm', label: 'Communication Modules', emoji: '📡' },
  { id: 'sound', label: 'Sound & Audio', emoji: '🔊' },
  { id: 'presence', label: 'Presence (PIR & Radar)', emoji: '🚶' },
  { id: 'magnetic', label: 'Magnetic Sensors', emoji: '🧲' },
  { id: 'display', label: 'Displays', emoji: '🖥️' },
  { id: 'motor', label: 'Motors & Drivers', emoji: '⚙️' },
  { id: 'relay', label: 'Relays & Switching', emoji: '🔌' },
  { id: 'power', label: 'Power & Batteries', emoji: '🔋' },
  { id: 'hmi', label: 'Buttons, Touch & Controls', emoji: '👆' },
  { id: 'ir', label: 'Infrared & Flame', emoji: '🔥' },
  { id: 'safety', label: 'Security & Safety', emoji: '🛡️' },
  { id: 'special', label: 'Special Sensors (health, weather...)', emoji: '❤️' },
  { id: 'parts', label: 'Electronic Components', emoji: '🧩' },
  { id: 'tools', label: 'Tools & Prototyping', emoji: '🛠️' },
];

const PART_LISTS = {
  temp: L(`DHT11
DHT22
AM2301
AM2320
SHT10
SHT20
SHT30
SHT31
SHT35
BME280
BME680
BME688
BMP180
BMP280
BMP388
BMP390
DS18B20
LM35
TMP36
MCP9808
AHT10
AHT20
AHT21
HTU21D
Si7021
SHT40
SHT41
SHT45
MAX6675
MAX31855
MAX31865
PT100
PT1000
NTC Thermistor
PTC Thermistor`),
  distance: L(`HC-SR04
HC-SR05
JSN-SR04T
US-100
US-015
VL53L0X
VL53L1X
VL53L4CD
VL53L5CX
VL6180X
GP2Y0A21YK0F
GP2Y0A02YK0F
Sharp IR Sensor
E18-D80NK
TCRT5000
IR Obstacle Sensor
IR Proximity Sensor
Capacitive Proximity Sensor
Inductive Proximity Sensor
Magnetic Proximity Sensor`),
  imu: L(`MPU6050
MPU6500
MPU9250
MPU6886
ICM20948
ICM42688
ICM20602
ADXL345
ADXL335
ADXL377
LIS3DH
LIS3DSH
LSM6DS3
LSM6DSOX
BNO055
BNO080
BNO085
BMI160
BMI270
L3G4200D
HMC5883L
QMC5883L
AK8963`),
  gas: L(`MQ-2
MQ-3
MQ-4
MQ-5
MQ-6
MQ-7
MQ-8
MQ-9
MQ-131
MQ-135
MQ-136
MQ-137
MQ-138
MQ-303A
MQ-309A
CCS811
SGP30
SGP40
SGP41
ENS160
BME680
BME688
SDS011
PMS5003
PMS7003
SEN0177
MH-Z19B
MH-Z14A
MH-Z16
SCD30
SCD40
SCD41
ZE08-CH2O
MiCS-5524
MiCS-6814`),
  light: L(`LDR
BH1750
TSL2561
TSL2591
VEML7700
VEML6075
TCS3200
TCS34725
APDS9960
MAX44009
OPT3001
TEMT6000
GUVA-S12SD
VEML6070
LTR-303
LTR-329
MAX30102
MAX30105`),
  water: L(`Soil Moisture Sensor
Capacitive Soil Moisture Sensor
Resistive Soil Moisture Sensor
Rain Sensor
Raindrop Detection Sensor
Water Level Sensor
Float Switch
Water Flow Sensor YF-S201
Water Flow Sensor YF-S401
Water Pressure Sensor
pH Sensor
TDS Sensor
EC Sensor
Turbidity Sensor
Dissolved Oxygen Sensor
ORP Sensor
Salinity Sensor
Water Temperature Sensor
DS18B20 Waterproof
Leaf Wetness Sensor
Soil Temperature Sensor
Soil NPK Sensor
RS485 Soil Sensor`),
  gps: L(`NEO-6M
NEO-7M
NEO-8M
NEO-M8N
NEO-M9N
MAX-M10S
ATGM336H
BN-220
BN-880
ZED-F9P
M10 GPS
GPS Compass Module
GNSS Module
RTK GPS Module`),
  comm: L(`HC-05
HC-06
HC-08
HM-10
JDY-23
ESP-01
ESP-12E
ESP-12F
NRF24L01
NRF24L01 PA LNA
LoRa SX1278
LoRa SX1276
LoRa SX1262
RA-02 LoRa
RFM95W
SIM800L
SIM900A
SIM7600
A7670
A7672
SIM7070
SIM7080
SIM7000
Quectel EC200U
Quectel BG95
W5500 Ethernet
ENC28J60
LAN8720
RS485 MAX485
CAN Bus MCP2515
MCP2551
TJA1050
USB to TTL CP2102
CH340
FT232RL`),
  sound: L(`KY-037
KY-038
MAX9814
MAX4466
INMP441
SPH0645
MAX98357A
MAX9744
LM386
Microphone Module
Sound Detection Module
Analog Sound Sensor
Digital Sound Sensor
Voice Recognition Module
DFPlayer Mini
ISD1820`),
  presence: L(`HC-SR501 PIR
HC-SR505 PIR
AM312 PIR
RCWL-0516 Microwave Radar
LD2410
LD2450
LD2420
24GHz Radar Sensor
60GHz Radar Sensor
Microwave Motion Sensor
Doppler Radar Sensor`),
  magnetic: L(`A3144 Hall Sensor
KY-003 Hall Sensor
SS49E
OH49E
US1881
MLX90393
QMC5883L
HMC5883L
Reed Switch
Magnetic Door Sensor
Magnetic Field Sensor
Compass Sensor`),
  display: L(`16x2 LCD
20x4 LCD
128x64 LCD
OLED 0.91 Inch
OLED 0.96 Inch
OLED 1.3 Inch
OLED 2.42 Inch
TFT 1.8 Inch
TFT 2.4 Inch
TFT 2.8 Inch
TFT 3.5 Inch
ILI9341
ST7789
ILI9488
Nextion Display
E-Paper Display
MAX7219 LED Matrix
TM1637 Display
7 Segment Display
8x8 LED Matrix
RGB LED Matrix`),
  motor: L(`L298N
L293D
TB6612FNG
DRV8833
DRV8825
A4988
TMC2208
TMC2209
TMC5160
BTS7960
VNH2SP30
PCA9685
ULN2003
ULN2803
L9110S
L9110
DC Motor
Servo Motor SG90
Servo Motor MG90S
Servo Motor MG996R
Stepper Motor 28BYJ-48
NEMA 17 Stepper Motor
NEMA 23 Stepper Motor
BLDC Motor
ESC`),
  relay: L(`1 Channel Relay
2 Channel Relay
4 Channel Relay
8 Channel Relay
16 Channel Relay
Solid State Relay
SSR Module
5V Relay
12V Relay
24V Relay
MOSFET Module
IRF520 MOSFET
IRLZ44N MOSFET
AO3400 MOSFET
Optocoupler Module
PC817
MOC3021
MOC3063
Triac Module
Dimmer Module`),
  power: L(`LM2596
LM2577
XL4015
MP1584
AMS1117
LM7805
LM7812
TP4056
TP5100
BMS 1S
BMS 2S
BMS 3S
BMS 4S
BMS 5S
INA219
INA226
INA260
ACS712
ACS758
ZMPT101B
Voltage Sensor Module
Current Sensor Module
Battery Voltage Monitor
DC-DC Buck Converter
DC-DC Boost Converter
Buck-Boost Converter
Solar Charge Controller`),
  hmi: L(`TTP223 Touch Sensor
TTP229 Touch Keypad
MPR121
Capacitive Touch Sensor
Touch Button Module
Rotary Encoder KY-040
Rotary Encoder Module
Joystick Module
Analog Joystick
PS2 Joystick
Push Button Module
Toggle Switch
Limit Switch
Endstop Switch
Foot Switch
Active Buzzer`),
  ir: L(`IR Receiver VS1838B
IR Transmitter
KY-022
TSOP1738
IR Remote Receiver
IR Flame Sensor
UV Flame Sensor
Flame Detection Module
Thermal Infrared Sensor
MLX90614
MLX90640
AMG8833`),
  safety: L(`Smoke Sensor
Fire Detection Sensor
Flame Sensor
Gas Leakage Sensor
Vibration Sensor SW-420
Tilt Sensor
Shock Sensor
Door Magnetic Sensor
Window Magnetic Sensor
Water Leakage Sensor
Glass Break Sensor
Tamper Switch`),
  special: L(`Heart Rate Sensor
MAX30102
MAX30105
ECG AD8232
EMG Sensor
EEG Sensor
GSR Sensor
Galvanic Skin Response Sensor
Gesture Sensor
APDS9960
Radar Sensor
Laser Sensor
UV Sensor
Radiation Sensor
Geiger Counter Module
Seismic Sensor
Earthquake Sensor
Flex Sensor
Bend Sensor
Liquid Flow Sensor
Airflow Sensor
Wind Speed Sensor
Wind Direction Sensor
Anemometer
Rain Gauge
PIR Sensor`),
  parts: L(`Resistors
Capacitors
Ceramic Capacitors
Electrolytic Capacitors
Diodes
Zener Diodes
LEDs
RGB LEDs
Transistors
MOSFETs
ICs
Logic Gates
Optocouplers
Voltage Regulators
Crystal Oscillators
Inductors
Potentiometers
Trimmers
Breadboards
Perfboards
Jumper Wires
Headers
Connectors
Terminal Blocks
Screw Terminals
Heat Sinks
Fuses`),
  tools: L(`Breadboard
Arduino Sensor Shield
ESP32 Expansion Board
ESP32 Relay Board
ESP32 Development Shield
Proto Shield
PCB Prototype Board
USB TTL Programmer
ST-Link V2
J-Link Debugger
USBasp Programmer
Logic Analyzer
Oscilloscope
Digital Multimeter
Soldering Station
Hot Air Station
Bench Power Supply
Wire Stripper
Crimping Tool`),
};
// categories whose items are only inventory (no code)
const INFO_ONLY = new Set(['tools']);
const INFO_NAMES = new Set(['Resistors', 'Capacitors', 'Ceramic Capacitors', 'Electrolytic Capacitors', 'Diodes', 'Zener Diodes', 'Transistors', 'MOSFETs', 'ICs', 'Logic Gates', 'Optocouplers', 'Voltage Regulators', 'Crystal Oscillators', 'Inductors', 'Trimmers', 'Breadboards', 'Perfboards', 'Jumper Wires', 'Headers', 'Connectors', 'Terminal Blocks', 'Screw Terminals', 'Heat Sinks', 'Fuses', 'LM2596', 'LM2577', 'XL4015', 'MP1584', 'AMS1117', 'LM7805', 'LM7812', 'TP4056', 'TP5100', 'BMS 1S', 'BMS 2S', 'BMS 3S', 'BMS 4S', 'BMS 5S', 'DC-DC Buck Converter', 'DC-DC Boost Converter', 'Buck-Boost Converter', 'Solar Charge Controller', 'DC Motor', 'BLDC Motor', 'USB to TTL CP2102', 'CH340', 'FT232RL', 'TJA1050', 'MCP2551']);

// ---------- boards ----------
const B = (id, name, family, emoji, o = {}) => ({ id, name, family, emoji, wifi: false, ready: false, profile: null, targets: [], excludePins: [], note: '', ...o });
const ESP32T = ['esp32-arduino', 'esp32-micropython'];
const BOARDS_LIB = [
  B('simulator', 'No board yet - try in the simulator', 'Start here', '🎮', { ready: true, profile: 'pc', wifi: true, targets: ['pc-python', 'pc-nodejs'], note: 'Runs on your computer. Great for learning: pins print what they would do.' }),
  B('esp32-devkit-v1', 'ESP32 DevKit V1', 'ESP32', '🟦', { ready: true, profile: 'esp32', wifi: true, targets: ESP32T }),
  B('esp32-wroom-32', 'ESP32-WROOM-32', 'ESP32', '🟦', { ready: true, profile: 'esp32', wifi: true, targets: ESP32T }),
  B('esp32-wrover', 'ESP32-WROVER', 'ESP32', '🟦', { ready: true, profile: 'esp32', wifi: true, targets: ESP32T, excludePins: ['16', '17'], note: 'GPIO16 and GPIO17 are used by its memory chip, so they are hidden.' }),
  B('esp8266-nodemcu', 'ESP8266 NodeMCU', 'ESP8266', '🟩', { ready: true, profile: 'esp8266', wifi: true, targets: ['esp8266-arduino', 'esp8266-micropython'] }),
  B('esp8266-wemos-d1-mini', 'ESP8266 Wemos D1 Mini', 'ESP8266', '🟩', { ready: true, profile: 'esp8266', wifi: true, targets: ['esp8266-arduino', 'esp8266-micropython'] }),
  B('pico-w', 'Raspberry Pi Pico W', 'Raspberry Pi Pico', '🍓', { ready: true, profile: 'picow', wifi: true, targets: ['picow-arduino', 'picow-micropython'] }),
  B('rpi-zero', 'Raspberry Pi Zero', 'Raspberry Pi computers', '🍓', { ready: true, profile: 'rpi', targets: ['rpi-python'] }),
  B('rpi-4', 'Raspberry Pi 4', 'Raspberry Pi computers', '🍓', { ready: true, profile: 'rpi', targets: ['rpi-python'] }),
  B('rpi-5', 'Raspberry Pi 5', 'Raspberry Pi computers', '🍓', { ready: true, profile: 'rpi', targets: ['rpi-python'] }),
  // ---- listed, not yet generating code ----
  ...['Arduino Uno R3', 'Arduino Uno R4', 'Arduino Mega 2560', 'Arduino Nano', 'Arduino Nano Every', 'Arduino Leonardo', 'Arduino Micro', 'Arduino Pro Mini', 'Arduino Due', 'Arduino Giga R1'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'Arduino', '🟦', { note: 'No Wi-Fi: needs a USB "bridge" mode, which is planned.' })),
  ...['ESP32-S2', 'ESP32-S3', 'ESP32-C2', 'ESP32-C3', 'ESP32-C5', 'ESP32-C6', 'ESP32-H2', 'ESP32-P4', 'ESP32-CAM', 'ESP32-S3 CAM'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'ESP32', '🟦', { wifi: true, note: 'Pin map differs from the classic ESP32 - being added after it is verified.' })),
  ...['Raspberry Pi Pico', 'Raspberry Pi Pico 2', 'Raspberry Pi Pico 2 W', 'RP2040', 'RP2350'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'Raspberry Pi Pico', '🍓', { note: 'Planned (Pico W is ready today).' })),
  ...['STM32 Blue Pill', 'STM32 Black Pill', 'STM32 Nucleo'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'STM32', '🟧', { note: 'No Wi-Fi: needs a bridge or modem.' })),
  ...['Teensy 4.0', 'Teensy 4.1'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'Other boards', '🟪', { note: 'Planned.' })),
  ...['BBC Micro:bit', 'ATtiny85', 'ATmega328P', 'ATmega2560'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'Other boards', '🟪', { note: 'Planned.' })),
  ...['BeagleBone Black', 'Orange Pi'].map((n) => B(n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, 'Linux computers', '🖥️', { note: 'Planned (different GPIO library).' })),
];

module.exports = { CATEGORIES, PART_LISTS, INFO_ONLY, INFO_NAMES, BOARDS_LIB };
