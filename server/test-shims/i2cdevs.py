# Test-only simulated I2C chips (used with the fake MicroPython `machine.I2C`).
# Each chip follows the protocol from its datasheet, including ordering rules, so the generated drivers are really exercised.
import struct

def crc8(data):  # Sensirion CRC-8: polynomial 0x31, init 0xFF
    crc = 0xFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x31) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc

class Dev:
    def write(self, buf): raise OSError(5, "EIO")
    def read(self, n): raise OSError(5, "EIO")
    def write_mem(self, reg, buf): raise OSError(5, "EIO")
    def read_mem(self, reg, n): raise OSError(5, "EIO")

class BH1750(Dev):
    def __init__(self): self.mode = None
    def write(self, buf):
        if buf[0] in (0x01, 0x10): self.mode = buf[0]
    def read(self, n):
        if self.mode != 0x10: raise OSError(5, "no measurement mode set")
        return bytes([0x12, 0x34])[:n]                      # raw 0x1234 -> 4660 / 1.2 = 3883.33 lx

class AHT20(Dev):
    def __init__(self): self.inited = False; self.triggered = False
    def write(self, buf):
        if list(buf) == [0xBE, 0x08, 0x00]: self.inited = True
        elif list(buf) == [0xAC, 0x33, 0x00]:
            if not self.inited: raise OSError(5, "not initialised")
            self.triggered = True
    def read(self, n):
        if not self.triggered: raise OSError(5, "no measurement triggered")
        rh, rt = 0x80000, 0x66666                           # 50.0 %  and  ~30.0 C
        return bytes([0x1C, (rh >> 12) & 0xFF, (rh >> 4) & 0xFF, ((rh & 0xF) << 4) | (rt >> 16), (rt >> 8) & 0xFF, rt & 0xFF])[:n]

class SHT31(Dev):
    def __init__(self): self.armed = False
    def write(self, buf):
        if list(buf) == [0x24, 0x00]: self.armed = True
    def read(self, n):
        if not self.armed: raise OSError(5, "no measurement")
        t, h = bytes([0x66, 0x66]), bytes([0x80, 0x00])
        return (t + bytes([crc8(t)]) + h + bytes([crc8(h)]))[:n]

class SHT31BadCrc(SHT31):
    def read(self, n):
        d = bytearray(super().read(n)); d[2] ^= 0xFF; return bytes(d)

class HTU21(Dev):
    def __init__(self): self.pending = None
    def write(self, buf):
        if buf[0] in (0xF3, 0xF5): self.pending = buf[0]
    def read(self, n):
        if self.pending == 0xF3: raw = 0x6660 | 0b10   # temperature, status bits 10
        elif self.pending == 0xF5: raw = 0x7C80 | 0b10 # humidity, status bits 10
        else: raise OSError(5, "no measurement")
        return bytes([raw >> 8, raw & 0xFF, 0])[:n]

class MCP9808(Dev):
    def __init__(self, regbytes): self.regbytes = bytes(regbytes)
    def read_mem(self, reg, n):
        if reg != 0x05: raise OSError(5, "bad register")
        return self.regbytes[:n]

class MPU6050(Dev):
    def __init__(self): self.awake = False
    def write_mem(self, reg, buf):
        if reg == 0x6B and buf[0] == 0: self.awake = True
    def read_mem(self, reg, n):
        if not self.awake or reg != 0x3B: raise OSError(5, "asleep")
        vals = [16384, -16384, 8192, 0, 131, -131, 262]      # ax ay az temp gx gy gz
        return struct.pack(">7h", *vals)[:n]

# BMP280 datasheet example calibration + raw values (T = 25.08 C, P = 100653.27 Pa)
CAL = dict(T1=27504, T2=26435, T3=-1000, P1=36477, P2=-10685, P3=3024, P4=2855, P5=140, P6=-7, P7=15500, P8=-14600, P9=6000)
HCAL = dict(H1=75, H2=366, H3=0, H4=316, H5=50, H6=30)
ADC_T, ADC_P, ADC_H = 519888, 415148, 28000

class BMx280(Dev):
    def __init__(self, humidity):
        self.hum = humidity; self.mem = bytearray(256); self.hum_ctrl_written = False
        self.mem[0xD0] = 0x60 if humidity else 0x58
        self.mem[0x88:0x88 + 24] = struct.pack("<HhhHhhhhhhhh", CAL["T1"], CAL["T2"], CAL["T3"], CAL["P1"], CAL["P2"], CAL["P3"], CAL["P4"], CAL["P5"], CAL["P6"], CAL["P7"], CAL["P8"], CAL["P9"])
        if humidity:
            h = HCAL; self.mem[0xA1] = h["H1"]
            self.mem[0xE1:0xE3] = struct.pack("<h", h["H2"]); self.mem[0xE3] = h["H3"]
            self.mem[0xE4] = (h["H4"] >> 4) & 0xFF; self.mem[0xE5] = (h["H4"] & 0x0F) | ((h["H5"] & 0x0F) << 4); self.mem[0xE6] = (h["H5"] >> 4) & 0xFF; self.mem[0xE7] = h["H6"] & 0xFF
    def write_mem(self, reg, buf):
        for i, b in enumerate(buf): self.mem[reg + i] = b
        if reg == 0xF2: self.hum_ctrl_written = True
        if reg == 0xF4 and (buf[0] & 0x03) == 0x01:                      # forced mode -> run one measurement
            p, t = ADC_P, ADC_T
            self.mem[0xF7:0xFA] = bytes([p >> 12, (p >> 4) & 0xFF, (p & 0xF) << 4]); self.mem[0xFA:0xFD] = bytes([t >> 12, (t >> 4) & 0xFF, (t & 0xF) << 4])
            h = ADC_H if (self.hum and self.hum_ctrl_written) else 0x8000  # 0x8000 = humidity "skipped" (datasheet)
            self.mem[0xFD:0xFF] = bytes([h >> 8, h & 0xFF])
    def read_mem(self, reg, n): return bytes(self.mem[reg:reg + n])

def make_bus(variant="all"):
    bus = {0x23: BH1750(), 0x38: AHT20(), 0x44: SHT31(), 0x40: HTU21(), 0x18: MCP9808([0x01, 0x90]), 0x19: MCP9808([0x1F, 0xF0]), 0x68: MPU6050(), 0x76: BMx280(True), 0x77: BMx280(False)}
    if variant == "badcrc": bus[0x44] = SHT31BadCrc()
    return bus
