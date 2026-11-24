import random
class Pin:
    OUT, IN, PULL_UP = 1, 0, 2
    def __init__(self, p, mode=None, pull=None): self.p = p; self.mode = mode
    def value(self, v=None):
        if v is None: return random.randint(0, 1)
        print("[hw] OUT pin=%s val=%s" % (self.p, v))
class PWM:
    def __init__(self, pin, freq=1000): self.pin = pin
    def duty_u16(self, d): print("[hw] PWM pin=%s level=%d" % (self.pin.p, round(d / 257)))
    def duty(self, d): print("[hw] PWM pin=%s level=%d" % (self.pin.p, round(d * 255 / 1023)))
class ADC:
    ATTN_11DB = 3
    def __init__(self, pin): pass
    def atten(self, a): pass
    def read_u16(self): return random.randint(0, 65535)
def time_pulse_us(pin, level, timeout): return 580

class I2C:
    """Fake I2C bus backed by simulated chips (i2cdevs.py)."""
    def __init__(self, *a, **k):
        import os, i2cdevs
        self.devs = i2cdevs.make_bus(os.environ.get("TRONIC_I2C_VARIANT", "all"))
    def _d(self, addr):
        if addr not in self.devs: raise OSError(19, "ENODEV")
        return self.devs[addr]
    def writeto(self, addr, buf): self._d(addr).write(bytes(buf))
    def readfrom(self, addr, n): return self._d(addr).read(n)
    def writeto_mem(self, addr, reg, buf): self._d(addr).write_mem(reg, bytes(buf))
    def readfrom_mem(self, addr, reg, n): return self._d(addr).read_mem(reg, n)
SoftI2C = I2C
