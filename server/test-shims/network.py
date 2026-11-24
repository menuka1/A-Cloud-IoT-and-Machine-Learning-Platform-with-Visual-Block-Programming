# Test shim: pretends to be MicroPython's `network` module (used only by builder-test.js)
import time
time.sleep_us = lambda us: None          # MicroPython-only helper
STA_IF = 0
class WLAN:
    def __init__(self, mode): self._on = False
    def active(self, v=None):
        if v is not None: self._on = v
        return self._on
    def isconnected(self): return self._on
    def connect(self, ssid, pw): print("[hw] wifi connect", ssid)
    def ifconfig(self): return ("127.0.0.1", "", "", "")
