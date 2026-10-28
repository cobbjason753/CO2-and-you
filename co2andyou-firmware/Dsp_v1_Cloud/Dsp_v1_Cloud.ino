#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <Wire.h>
#include <LittleFS.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
//#include <Adafruit_NeoPixel.h>
#include "SparkFun_SCD4x_Arduino_Library.h"
#include "time.h"
#include <esp_mac.h>

//Begin jcobb changes
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
//End jcobb changes

const char* AP_NAME = "CO2AndYou-Setup";
const char* AP_PASSWORD = "cleanair2026";

//Begin jcobb Changes
// ---- InfluxDB Cloud ----
const char* INFLUX_URL    = "https://us-east-1-1.aws.cloud2.influxdata.com";
const char* INFLUX_ORG    = "Prototype";
const char* INFLUX_BUCKET = "Test";
#include "secrets.h"        // defines INFLUX_TOKEN; kept out of git (see secrets.example.h)
//const char* DEVICE_LOCATION = "downstairs";
char DEVICE_LOCATION[20];   // filled in at startup with the chip's unique ID

const char* INFLUX_ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// ---- OTA updates ----
// Release builds get FW_VERSION from the git tag (v7 -> 7) via the GitHub Action.
// Local IDE builds fall back to 1, so any published release will replace them.
#ifndef FW_VERSION
#define FW_VERSION 1
#endif

// Published by the GitHub Action to GitHub Pages. version.txt is two lines:
//   7
//   https://YOUR-GITHUB-USER.github.io/YOUR-REPO/firmware-v7.bin
const char* OTA_MANIFEST_URL = "https://YOUR-GITHUB-USER.github.io/YOUR-REPO/version.txt";
// TLS for OTA uses the core's built-in Mozilla root bundle (needs ESP32 core 3.3.12+).

const unsigned long OTA_CHECK_INTERVAL = 6UL * 60UL * 60UL * 1000UL; // check every 6 hours
const unsigned long OTA_TRIAL_TIMEOUT  = 20UL * 60UL * 1000UL;       // new build must upload to Influx within 20 min
const int OTA_TRIAL_MAX_BOOTS = 3;                                    // ...and not reboot more than 3 times
unsigned long lastOtaCheck = 0;
bool otaTrial = false;   // true while a freshly installed build is still proving itself
Preferences otaPrefs;

Preferences prefs;
time_t lastSentTs = 0;   // timestamp of the newest reading confirmed in InfluxDB
//End jcobb changes

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
bool oledOK = false;

#define LED_PIN 48
#define NUM_LEDS 1
//Adafruit_NeoPixel pixel(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

SCD4x mySensor;
bool sensorOK = false;
WebServer server(80);

struct Reading {
  time_t timestamp;
  float co2;
  float temp;
  float hum;
};

const int MAX_READINGS = 288;
Reading history[MAX_READINGS];
int readingCount = 0;
int writeIndex = 0;

unsigned long lastSampleTime = 0;
const unsigned long sampleInterval = 5UL * 60UL * 1000UL; // 5 min 
//const unsigned long sampleInterval = 30UL * 1000UL; // TEMP for testing 30Second interval

unsigned long lastDisplaySwitch = 0;
const unsigned long displayInterval = 15UL * 1000UL; // 15 sec
int displayMode = 0;

const char* HISTORY_FILE = "/history.dat";

float celsiusToFahrenheit(float c) {
  return c * 9.0 / 5.0 + 32.0;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("CP1: Serial up");
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(DEVICE_LOCATION, sizeof(DEVICE_LOCATION), "esp32-%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_LOCATION);
  Serial.printf("Firmware v%d\n", FW_VERSION);
  otaBootCheck();   // early, so a build that crashes during setup still gets counted
  Wire.begin(8, 9);
  Serial.println("CP2: Wire up");
  Serial.println("I2C scan:");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found device at 0x%02X\n", addr);
    }
  }
  Serial.println("I2C scan done");
  //pixel.begin();
  //pixel.setBrightness(60);
  //pixel.show();
  Serial.println("CP3: LED up");

  oledOK = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  Serial.println(oledOK ? "CP4: OLED found" : "CP4: OLED NOT found");

  if (oledOK) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    display.setCursor(0, 20);
    display.println("Starting...");
    display.display();
  }
  Serial.println("CP5: past OLED block");

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
  } else {
    loadHistoryFromFlash();
  }
  Serial.println("CP6: LittleFS done");

  //Begin jcobb changes
    prefs.begin("influx", false);
  lastSentTs = prefs.getLong64("lastSent", 0);
  //End jcobb changes

  WiFiManager wm;
  if (otaTrial) wm.setConfigPortalTimeout(120);  // new build can't get online -> restart -> counts toward rollback
  bool connected = wm.autoConnect(AP_NAME, AP_PASSWORD);
  if (!connected) {
    Serial.println("Setup timed out, restarting.");
    ESP.restart();
  }
  Serial.println("CP7: WiFi connected");

  Serial.print("Connected! IP address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin("co2you")) {
    Serial.println("Dashboard also reachable at: http://co2you.local");
  }

  configTime(0, 0, "pool.ntp.org");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    otaTrialTick();
    delay(500);
  }
  Serial.println("CP8: time synced");

  mySensor.stopPeriodicMeasurement();
  delay(500);
  sensorOK = mySensor.begin();
  Serial.println(sensorOK ? "CP9: sensor found" : "CP9: Sensor not detected!");

  server.on("/", handleRoot);
  server.on("/data.csv", handleCSV);
  server.begin();
  Serial.println("CP10: server started");

  lastOtaCheck = millis();
  otaCheckForUpdate();
}

void loop() {
  server.handleClient();

  if (sensorOK && millis() - lastSampleTime >= sampleInterval) {
    lastSampleTime = millis();
    if (mySensor.readMeasurement()) {
      time_t now;
      time(&now);
      history[writeIndex].timestamp = now;
      history[writeIndex].co2 = mySensor.getCO2();
      history[writeIndex].temp = mySensor.getTemperature();
      history[writeIndex].hum = mySensor.getHumidity();
      writeIndex = (writeIndex + 1) % MAX_READINGS;
      if (readingCount < MAX_READINGS) readingCount++;
      saveHistoryToFlash();
      Serial.println("Sample logged.");
      //Begin jcobb changes
            sendToInflux();
            //End jcobb Changes
    }
  }

  if (millis() - lastDisplaySwitch >= displayInterval) {
    lastDisplaySwitch = millis();
    displayMode = (displayMode + 1) % 3;
  }

  if (millis() - lastOtaCheck >= OTA_CHECK_INTERVAL) {
    lastOtaCheck = millis();
    otaCheckForUpdate();
  }
  otaTrialTick();

  updateDisplay();
  updateLED();
  delay(200);
}

void updateDisplay() {
  if (!oledOK) return;

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);

  if (!sensorOK) {
    display.println("Sensor error");
    display.setCursor(0, 20);
    display.println("Check wiring");
    display.display();
    return;
  }

  if (readingCount == 0) {
    display.println("Warming up...");
    display.display();
    return;
  }

  int lastIdx = (writeIndex - 1 + MAX_READINGS) % MAX_READINGS;
  float co2 = history[lastIdx].co2;
  float tempF = celsiusToFahrenheit(history[lastIdx].temp);
  float hum = history[lastIdx].hum;

  String label;
  String bigValue;
  String unit;

  if (displayMode == 0) {
    label = "CO2";
    bigValue = String((int)co2);
    unit = "ppm";
  } else if (displayMode == 1) {
    label = "TEMP";
    bigValue = String(tempF, 1);
    unit = "F";
  } else {
    label = "HUMIDITY";
    bigValue = String(hum, 1);
    unit = "%";
  }

  display.println(label);

  display.setTextSize(4);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(bigValue, 0, 0, &x1, &y1, &w, &h);
  int xPos = (SCREEN_WIDTH - w) / 2;
  display.setCursor(xPos, 22);
  display.println(bigValue);

  display.setTextSize(1);
  display.setCursor(0, 56);
  display.println(unit);

  display.display();
}

void updateLED() {
  if (!sensorOK || readingCount == 0) return;
  int lastIdx = (writeIndex - 1 + MAX_READINGS) % MAX_READINGS;
  float co2 = history[lastIdx].co2;

  // Values pre-scaled to roughly match your old brightness of 60
  if (co2 < 800) {
    rgbLedWrite(LED_PIN, 0, 60, 0);      // green
  } else if (co2 < 1000) {
    rgbLedWrite(LED_PIN, 60, 42, 0);     // amber
  } else {
    rgbLedWrite(LED_PIN, 60, 0, 0);      // red
  }
}

void saveHistoryToFlash() {
  File f = LittleFS.open(HISTORY_FILE, "w");
  if (!f) return;
  f.write((uint8_t*)&readingCount, sizeof(readingCount));
  f.write((uint8_t*)&writeIndex, sizeof(writeIndex));
  f.write((uint8_t*)history, sizeof(history));
  f.close();
}

void loadHistoryFromFlash() {
  if (!LittleFS.exists(HISTORY_FILE)) return;
  File f = LittleFS.open(HISTORY_FILE, "r");
  if (!f) return;
  f.read((uint8_t*)&readingCount, sizeof(readingCount));
  f.read((uint8_t*)&writeIndex, sizeof(writeIndex));
  f.read((uint8_t*)history, sizeof(history));
  f.close();
}

void handleRoot() {
  String html = "<html><head><title>CO2 & You</title>";
  html += "<meta http-equiv='refresh' content='60'>";
  html += "<style>body{font-family:sans-serif;margin:20px;background:#f4f6f8}h1{color:#1F3A5F}.stat{font-size:2em;font-weight:bold}</style></head><body>";
  html += "<h1>CO2 & You</h1>";
  if (!sensorOK) {
    html += "<p>Sensor not detected.</p>";
  } else if (readingCount > 0) {
    int lastIdx = (writeIndex - 1 + MAX_READINGS) % MAX_READINGS;
    html += "<p>Current CO2: <span class='stat'>" + String(history[lastIdx].co2, 0) + " ppm</span></p>";
    html += "<p>Temp: " + String(celsiusToFahrenheit(history[lastIdx].temp), 1) + " F &nbsp; Humidity: " + String(history[lastIdx].hum, 1) + "%</p>";
    html += "<p><a href='/data.csv'>Download CSV</a></p>";
  } else {
    html += "<p>No readings yet.</p>";
  }
  html += "<p style='color:#888;font-size:0.8em'>" + String(DEVICE_LOCATION) + " &middot; firmware v" + String(FW_VERSION) + "</p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

void handleCSV() {
  String csv = "timestamp_utc,co2_ppm,temp_f,humidity_pct\n";
  for (int i = 0; i < readingCount; i++) {
    int idx = (writeIndex - readingCount + i + MAX_READINGS) % MAX_READINGS;
    struct tm* t = gmtime(&history[idx].timestamp);
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", t);
    csv += String(buf) + "," + String(history[idx].co2, 0) + "," +
           String(celsiusToFahrenheit(history[idx].temp), 1) + "," + String(history[idx].hum, 1) + "\n";
  }
  server.send(200, "text/csv", csv);
}

//Begin jcobb changes
void sendToInflux() {
  if (WiFi.status() != WL_CONNECTED || readingCount == 0) return;

  // Build a batch of every buffered reading not yet sent, oldest first
  String body;
  time_t newest = lastSentTs;
  for (int i = 0; i < readingCount; i++) {
    int idx = (writeIndex - readingCount + i + MAX_READINGS) % MAX_READINGS;
    Reading& r = history[idx];
    if (r.timestamp <= lastSentTs) continue;

    char line[160];
    snprintf(line, sizeof(line),
      "environment,location=%s co2_ppm=%di,temp_f=%.1f,humidity_pct=%.1f,fw_version=%di %lld\n",
      DEVICE_LOCATION, (int)r.co2, celsiusToFahrenheit(r.temp), r.hum, FW_VERSION,
      (long long)r.timestamp);
    body += line;
    newest = r.timestamp;
  }
  if (body.length() == 0) return;

  WiFiClientSecure client;
  client.setCACert(INFLUX_ROOT_CA);

  HTTPClient http;
  String url = String(INFLUX_URL) + "/api/v2/write?org=" + INFLUX_ORG +
               "&bucket=" + INFLUX_BUCKET + "&precision=s";
  http.begin(client, url);
  http.setTimeout(10000);
  http.addHeader("Authorization", String("Token ") + INFLUX_TOKEN);
  http.addHeader("Content-Type", "text/plain; charset=utf-8");

  int code = http.POST(body);
  if (code == 204) {
    lastSentTs = newest;
    prefs.putLong64("lastSent", lastSentTs);
    Serial.println("Influx: upload OK");
    otaMarkGood();   // a successful upload is the health check for a newly installed build
  } else {
    Serial.printf("Influx: upload failed (%d) %s\n", code, http.getString().c_str());
  }
  http.end();
}
//End jcobb changes
// ================= OTA updates =================
// Flow: every OTA_CHECK_INTERVAL the device fetches version.txt. If it lists a higher
// version, the .bin is written to the spare app partition and the device reboots into it
// in "trial" mode. The new build is kept only once it uploads to InfluxDB successfully.
// If it reboots too many times or can't upload within OTA_TRIAL_TIMEOUT, the device
// switches back to the previous build and remembers not to install that version again.

void otaBootCheck() {
  otaPrefs.begin("ota", false);
  otaTrial = otaPrefs.getBool("trial", false);
  if (!otaTrial) return;

  int boots = otaPrefs.getInt("boots", 0) + 1;
  otaPrefs.putInt("boots", boots);
  Serial.printf("OTA: trial boot %d of %d for v%d\n", boots, OTA_TRIAL_MAX_BOOTS, FW_VERSION);
  if (boots > OTA_TRIAL_MAX_BOOTS) otaRollback("too many restarts");
}

void otaTrialTick() {
  if (otaTrial && millis() > OTA_TRIAL_TIMEOUT) otaRollback("no successful upload in time");
}

void otaMarkGood() {
  if (!otaTrial) return;
  otaTrial = false;
  otaPrefs.putBool("trial", false);
  otaPrefs.putInt("boots", 0);
  esp_ota_mark_app_valid_cancel_rollback();   // harmless if the bootloader isn't tracking rollback
  Serial.printf("OTA: v%d confirmed good\n", FW_VERSION);
}

void otaRollback(const char* why) {
  Serial.printf("OTA: rolling back v%d (%s)\n", FW_VERSION, why);
  otaPrefs.putBool("trial", false);
  otaPrefs.putInt("boots", 0);
  otaPrefs.putInt("badVer", FW_VERSION);      // don't re-download this version

  // With two OTA slots, the "next" slot is the one holding the previous build
  const esp_partition_t* prev = esp_ota_get_next_update_partition(NULL);
  if (prev && esp_ota_set_boot_partition(prev) == ESP_OK) {
    saveHistoryToFlash();
    delay(200);
    ESP.restart();
  }
  otaTrial = false;
  Serial.println("OTA: no previous build to roll back to; staying on this one");
}

void otaCheckForUpdate() {
  if (otaTrial || WiFi.status() != WL_CONNECTED) return;
  if (strstr(OTA_MANIFEST_URL, "YOUR-GITHUB-USER")) return;   // not configured yet

  // 1. Fetch the manifest
  WiFiClientSecure client;
  client.useBuiltinCACertBundle();
  HTTPClient http;
  http.begin(client, OTA_MANIFEST_URL);
  http.setTimeout(10000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("OTA: manifest fetch failed (%d)\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();

  body.trim();
  int nl = body.indexOf('\n');
  if (nl < 0) {
    Serial.println("OTA: manifest format not recognized");
    return;
  }
  int remote = body.substring(0, nl).toInt();
  String binUrl = body.substring(nl + 1);
  binUrl.trim();

  Serial.printf("OTA: running v%d, available v%d\n", FW_VERSION, remote);
  if (remote <= FW_VERSION) return;
  if (remote == otaPrefs.getInt("badVer", 0)) {
    Serial.println("OTA: that version was rolled back before; skipping");
    return;
  }

  // 2. Download and flash into the spare partition
  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 20);
    display.println("Updating..");
    display.display();
  }
  saveHistoryToFlash();

  WiFiClientSecure binClient;
  binClient.useBuiltinCACertBundle();
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  t_httpUpdate_return ret = httpUpdate.update(binClient, binUrl);

  if (ret == HTTP_UPDATE_OK) {
    otaPrefs.putBool("trial", true);
    otaPrefs.putInt("boots", 0);
    Serial.printf("OTA: v%d installed, rebooting\n", remote);
    delay(200);
    ESP.restart();
  } else {
    Serial.printf("OTA: update failed (%d) %s\n",
                  httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
  }
}
