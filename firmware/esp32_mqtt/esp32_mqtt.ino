// TronicIOT - ESP32 over MQTT (instant commands). Library: PubSubClient (Nick O'Leary)
// Broker: your TronicIOT server, port 1883. MQTT username = device token, password = empty.
#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "YOUR_SERVER_IP";
const int   MQTT_PORT = 1883;
const char* TOKEN     = "tr_PASTE_DEVICE_TOKEN";
const int   LED_PIN   = 2;

String topicData = String("tronic/") + TOKEN + "/data";
String topicCmd  = String("tronic/") + TOKEN + "/cmd";
WiFiClient net;
PubSubClient mqtt(net);

void onMessage(char*, byte* payload, unsigned int len) {
  String msg; for (unsigned i = 0; i < len; i++) msg += (char)payload[i];
  Serial.println("command: " + msg);               // {"id":1,"name":"led","value":"1"}
  if (msg.indexOf("\"led\"") >= 0) digitalWrite(LED_PIN, msg.indexOf("\"value\":\"1\"") >= 0 ? HIGH : LOW);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String id = "esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str(), TOKEN, "")) mqtt.subscribe(topicCmd.c_str());
    else { Serial.println("MQTT failed, retrying"); delay(2000); }
  }
}

void setup() {
  Serial.begin(115200); pinMode(LED_PIN, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    last = millis();
    float temp = 24.5;                               // TODO: real sensor
    String json = "{\"temp\":" + String(temp) + "}";
    mqtt.publish(topicData.c_str(), json.c_str());
  }
}
