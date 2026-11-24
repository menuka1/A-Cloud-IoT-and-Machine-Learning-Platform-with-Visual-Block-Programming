# TronicIOT - Raspberry Pi Pico W (or ESP32) with MicroPython: send data + poll commands.
import network, time, urequests, machine

WIFI_SSID, WIFI_PASS = "YOUR_WIFI_NAME", "YOUR_WIFI_PASSWORD"
SERVER = "http://YOUR_SERVER_IP:3000"
TOKEN = "tr_PASTE_DEVICE_TOKEN"
H = {"X-Device-Token": TOKEN}

wlan = network.WLAN(network.STA_IF); wlan.active(True); wlan.connect(WIFI_SSID, WIFI_PASS)
while not wlan.isconnected(): time.sleep(0.5)
print("connected", wlan.ifconfig())

adc = machine.ADC(4)                 # Pico internal temperature sensor
led = machine.Pin("LED", machine.Pin.OUT)

while True:
    v = adc.read_u16() * 3.3 / 65535
    temp = 27 - (v - 0.706) / 0.001721
    try:
        r = urequests.post(SERVER + "/api/ingest", json={"temp": round(temp, 2)}, headers=H); r.close()
        r = urequests.get(SERVER + "/api/device/commands", headers=H)
        for c in r.json().get("commands", []):
            print("command", c)
            if c["name"] == "led": led.value(int(c["value"]))
        r.close()
    except Exception as e:
        print("error", e)
    time.sleep(5)
