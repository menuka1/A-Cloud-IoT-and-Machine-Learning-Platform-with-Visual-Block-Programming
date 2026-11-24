// TronicIOT - run ML in the cloud from a tiny ESP32. No Raspberry Pi needed.
// 1) ML Studio -> create + train a model (e.g. Linear Regression: temp -> hum), note its ID
// 2) The board sends inputs, the cloud returns the prediction.
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const String SERVER   = "http://YOUR_SERVER_IP:3000";
const String TOKEN    = "tr_PASTE_DEVICE_TOKEN";
const int MODEL_ID    = 1;                           // ID shown in ML Studio / "Use in code"

// returns true and fills `out` with the model's first numeric result (value / score / cluster)
bool predict(float temp, float &out) {
  HTTPClient http;
  http.begin(SERVER + "/api/ml/models/" + String(MODEL_ID) + "/predict");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", TOKEN);
  int code = http.POST("{\"inputs\":{\"temp\":" + String(temp) + "}}");
  bool ok = false;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      JsonObject o = doc["output"];
      if (o["value"].is<float>())        { out = o["value"];   ok = true; }
      else if (o["score"].is<float>())   { out = o["score"];   ok = true; }
      else if (o["cluster"].is<float>()) { out = o["cluster"]; ok = true; }
    }
  }
  http.end();
  return ok;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  float r;
  if (predict(24.5, r)) Serial.printf("prediction: %.2f\n", r);
  else Serial.println("prediction failed (is the model trained?)");
  delay(10000);
}
