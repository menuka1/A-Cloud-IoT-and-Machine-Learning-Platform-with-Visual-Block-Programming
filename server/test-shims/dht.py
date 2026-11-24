class _D:
    def __init__(self, pin): pass
    def measure(self): pass
    def temperature(self): return 23.5
    def humidity(self): return 55.0
class DHT22(_D): pass
class DHT11(_D): pass
