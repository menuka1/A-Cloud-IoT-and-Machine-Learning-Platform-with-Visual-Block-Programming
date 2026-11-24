// TronicIOT - ESP32 over HTTP: send sensor data + receive dashboard commands.
// Libraries: ArduinoJson (Library Manager). Board: any ESP32.
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const String SERVER   = "http://YOUR_SERVER_IP:3000";   // TronicIOT server (LAN IP or domain)
const String TOKEN    = "tr_PASTE_DEVICE_TOKEN";        // Devices -> your device -> token
const int LED_PIN = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

void sendData(float temp, float hum) {
  HTTPClient http;
  http.begin(SERVER + "/api/ingest");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", TOKEN);
  String body = "{\"temp\":" + String(temp) + ",\"hum\":" + String(hum) + "}";
  Serial.printf("ingest -> HTTP %d\n", http.POST(body));
  http.end();
}

void checkCommands() {
  HTTPClient http;
  http.begin(SERVER + "/api/device/commands");
  http.addHeader("X-Device-Token", TOKEN);
  if (http.GET() == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      for (JsonObject c : doc["commands"].as<JsonArray>()) {
        String name = c["name"], value = c["value"];
        Serial.println("command: " + name + " = " + value);
        if (name == "led") digitalWrite(LED_PIN, value == "1" ? HIGH : LOW);
        // add your own commands here (relay, servo, pwm ...)
      }
    }
  }
  http.end();
}

void loop() {
  float temp = 24.5, hum = 60.0;     // TODO: read your real sensor (DHT22, BME280, DS18B20 ...)
  sendData(temp, hum);
  checkCommands();
  delay(5000);
}
