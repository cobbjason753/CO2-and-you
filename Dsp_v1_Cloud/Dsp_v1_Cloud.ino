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
#include <Update.h>
#include <esp_ota_ops.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"
//End jcobb changes

// ---- Setup portal ----
// Each device makes its own setup network, "CO2AndYou-XXXX" (last 4 hex digits of its MAC),
// with a random password generated on first boot. The OLED shows a QR code that joins it.
char apName[20];
char apPassword[12];
#include <qrcode.h>          // QR generator built into the ESP32 core (ESP-IDF)

// The device's name now comes from the CO2 & You portal: the customer names the room there
// and the server returns it with every upload. Kept in NVS so it shows straight after a reboot.
// (Earlier firmware asked for a House ID and Location ID on the setup page; an old Location ID
//  is sent once at enrollment so the portal can pre-fill the room name.)
const int NAME_MAX_LEN = 40;
char displayName[NAME_MAX_LEN + 1] = "";   // "" = not named yet
bool claimed = false;                      // server says this device belongs to a house
char legacyLocation[33] = "";
Preferences setupPrefs;

const int SETUP_BUTTON_PIN = 0;                   // BOOT button on ESP32-S3 dev boards
const unsigned long SETUP_HOLD_MS = 5000;         // hold this long to reopen setup
unsigned long setupButtonDownSince = 0;

// ---- CO2 & You platform API ----
// Every reading goes to our backend, signed with this device's own secret. No shared
// credentials live in the firmware, and one unit can be revoked without touching the rest.
const char* API_BASE = "https://app.cobsci.com";
char DEVICE_ID[20];        // filled in at startup with the chip's unique ID (esp32-<MAC>)
char deviceSecret[65];     // 32 random bytes as hex, generated on first boot, kept in NVS
bool enrolled = false;     // server has accepted our secret
bool serverAnswered = false;   // an upload has succeeded at least once, so claimed/name are known
int lastEnrollCode = 0;        // HTTP status of the last enroll attempt (404 = not registered)
unsigned long lastEnrollAttempt = 0;
bool uploadPending = false;    // readings waiting for a successful upload
unsigned long lastUploadAttempt = 0;
const unsigned long API_TIMEOUT_MS   = 30000;   // first request after idle wakes the server and database
const unsigned long ENROLL_RETRY_MS  = 60000;   // retry enrollment every minute until accepted
const unsigned long UPLOAD_RETRY_MS  = 60000;   // retry a failed upload after a minute, not at the next sample
Preferences devPrefs;
// TLS: the core's built-in Mozilla root bundle validates the server certificate
// (needs ESP32 core 3.3.12+), so a certificate renewal or CA change needs no firmware update.

// ---- OTA updates ----
// Release builds get FW_VERSION from the git tag (v7 -> 7) via the GitHub Action.
// Local IDE builds fall back to 1, so any published release will replace them.
#ifndef FW_VERSION
#define FW_VERSION 1
#endif

// The server decides which build each device should run (staff roll releases out to a pilot
// group first, then everyone) and offers it in the reply to an upload: version, URL, SHA-256.
const unsigned long OTA_TRIAL_TIMEOUT  = 20UL * 60UL * 1000UL;       // new build must upload successfully within 20 min
const int OTA_TRIAL_MAX_BOOTS = 3;                                    // ...and not reboot more than 3 times
bool otaTrial = false;   // true while a freshly installed build is still proving itself
Preferences otaPrefs;

Preferences prefs;
time_t lastSentTs = 0;   // timestamp of the newest reading confirmed by the server
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
unsigned long lastSampleAttempt = 0;
const unsigned long FIRST_SAMPLE_MS = 30UL * 1000UL;   // first reading ~30 s after start-up
const unsigned long SAMPLE_RETRY_MS = 5UL * 1000UL;    // sensor not ready: try again shortly
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
  snprintf(DEVICE_ID, sizeof(DEVICE_ID), "esp32-%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.printf("Firmware v%d\n", FW_VERSION);
  snprintf(apName, sizeof(apName), "CO2AndYou-%02X%02X", mac[4], mac[5]);
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  loadSetupSettings();
  loadDeviceSecret();
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
  prefs.begin("influx", false);   // namespace name kept so the upload position survives the update
  lastSentTs = prefs.getLong64("lastSent", 0);
  //End jcobb changes

  connectWiFiWithSetupPortal();
  Serial.println("CP7: WiFi connected");

  Serial.print("Connected! IP address: ");
  Serial.println(WiFi.localIP());

  // Unique per device, so several devices on one network don't collide: co2you-xxxx.local
  char mdnsName[48];
  snprintf(mdnsName, sizeof(mdnsName), "co2you-%c%c%c%c", tolower(apName[10]), tolower(apName[11]), tolower(apName[12]), tolower(apName[13]));
  if (MDNS.begin(mdnsName)) {
    Serial.printf("Dashboard also reachable at: http://%s.local\n", mdnsName);
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

  enrollWithServer();
  // Take the first reading soon after start-up instead of a full interval later
  // (unsigned arithmetic, so this is safe even right after boot).
  lastSampleTime = millis() - sampleInterval + FIRST_SAMPLE_MS;
}

void loop() {
  server.handleClient();

  if (sensorOK && millis() - lastSampleTime >= sampleInterval && millis() - lastSampleAttempt >= SAMPLE_RETRY_MS) {
    lastSampleAttempt = millis();
    if (mySensor.readMeasurement()) {
      lastSampleTime = millis();
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
      sendReadings();
    }
  }

  if (!enrolled && millis() - lastEnrollAttempt >= ENROLL_RETRY_MS) enrollWithServer();
  if (uploadPending && millis() - lastUploadAttempt >= UPLOAD_RETRY_MS) sendReadings();

  if (millis() - lastDisplaySwitch >= displayInterval) {
    lastDisplaySwitch = millis();
    // A 4th screen reminds the owner to link / name the device in the portal
    displayMode = (displayMode + 1) % (displayName[0] ? 3 : 4);
  }

  otaTrialTick();

  if (!checkSetupButton()) updateDisplay();
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

  if (displayMode == 3) {
    if (lastEnrollCode == 404) {
      display.println("Not registered");
      display.setCursor(0, 20);
      display.println("Contact support with");
      display.println(DEVICE_ID);
    } else if (!serverAnswered) {
      // Until the server has replied once we don't know whether this unit is linked or named.
      display.println("Connecting...");
      display.setCursor(0, 20);
      display.println("Sending first");
      display.println("readings to");
      display.println("CO2 & You");
    } else if (!claimed) {
      display.println("Not linked yet");
      display.setCursor(0, 20);
      display.println("Add it at cobsci.com");
      display.println("with the claim code");
      display.println("on its label");
    } else {
      display.println("Not named yet");
      display.setCursor(0, 20);
      display.println("Name this room in");
      display.println("the CO2 & You app");
    }
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

  display.print(label);
  if (displayName[0]) {             // room name from the portal, right-aligned
    int16_t nx, ny; uint16_t nw, nh;
    String name = String(displayName).substring(0, 12);
    display.getTextBounds(name, 0, 0, &nx, &ny, &nw, &nh);
    display.setCursor(SCREEN_WIDTH - nw, 0);
    display.print(name);
  }
  display.println();

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
  html += "<p>Name: <b>" + String(displayName[0] ? displayName : "not named yet") + "</b> &nbsp; (rename it in the CO2 &amp; You app)</p>";
  html += "<p style='color:#888;font-size:0.8em'>" + String(DEVICE_ID) + " &middot; firmware v" + String(FW_VERSION) + "</p>";
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

// ================= Platform API =================
// Device secret: 32 random bytes from the hardware RNG, made once and kept in NVS (survives
// OTA updates and reboots; erased only by a full flash erase). Printed on the serial console
// until the server accepts it, so the factory station can record it at provisioning.
void loadDeviceSecret() {
  devPrefs.begin("device", false);
  String s = devPrefs.getString("secret", "");
  if (s.length() != 64) {
    uint8_t raw[32];
    esp_fill_random(raw, sizeof(raw));
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", raw[i]);
    hex[64] = '\0';
    s = hex;
    devPrefs.putString("secret", s);
    devPrefs.putBool("enrolled", false);
  }
  strlcpy(deviceSecret, s.c_str(), sizeof(deviceSecret));
  enrolled = devPrefs.getBool("enrolled", false);
  claimed = devPrefs.getBool("claimed", false);
  serverAnswered = devPrefs.getBool("answered", false);
  String n = devPrefs.getString("name", "");
  strlcpy(displayName, n.c_str(), sizeof(displayName));
  if (!enrolled) Serial.printf("PROVISION: %s %s\n", DEVICE_ID, deviceSecret);
}

void hmacSha256Hex(const char* keyHex, const String& msg, char out[65]) {
  uint8_t key[32];
  for (int i = 0; i < 32; i++) {
    char b[3] = { keyHex[i * 2], keyHex[i * 2 + 1], 0 };
    key[i] = (uint8_t)strtoul(b, nullptr, 16);
  }
  uint8_t mac[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(info, key, sizeof(key), (const uint8_t*)msg.c_str(), msg.length(), mac);
  for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", mac[i]);
  out[64] = '\0';
}

// Sends our secret once, over HTTPS, so the server can verify signed uploads.
// 404 = this DEVICE_ID isn't registered yet (staff see it under "Unknown devices").
void enrollWithServer() {
  if (enrolled) return;
  lastEnrollAttempt = millis();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("API: enroll skipped (WiFi not connected)");
    return;
  }
  WiFiClientSecure client;
  client.useBuiltinCACertBundle();
  HTTPClient http;
  http.begin(client, String(API_BASE) + "/api/device/enroll");
  http.setTimeout(API_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["secret"] = deviceSecret;
  doc["fw"] = FW_VERSION;
  if (legacyLocation[0]) doc["legacy_location"] = legacyLocation;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  lastEnrollCode = code;
  if (code == 200) {
    enrolled = true;
    devPrefs.putBool("enrolled", true);
    Serial.println("API: enrolled");
  } else {
    Serial.printf("API: enroll failed (%d) %s\n", code, http.getString().c_str());
  }
  http.end();
}

// Uploads every buffered reading not yet confirmed, oldest first, signed with our secret:
//   X-Signature = hex HMAC-SHA256(secret, DEVICE_ID + "\n" + X-Timestamp + "\n" + body)
// The reply carries the name customers gave this device in the portal and, when staff have
// rolled out a newer build to it, an OTA offer.
void sendReadings() {
  lastUploadAttempt = millis();
  uploadPending = readingCount > 0;
  if (!uploadPending) return;
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("API: upload skipped (WiFi not connected); will retry");
    return;
  }
  if (!enrolled) {
    enrollWithServer();
    if (!enrolled) {
      Serial.println("API: upload skipped (not enrolled yet); will retry");
      return;
    }
  }

  String body = "{\"fw\":" + String(FW_VERSION) + ",\"rssi\":" + String(WiFi.RSSI()) + ",\"readings\":[";
  time_t newest = lastSentTs;
  int n = 0;
  for (int i = 0; i < readingCount; i++) {
    int idx = (writeIndex - readingCount + i + MAX_READINGS) % MAX_READINGS;
    Reading& r = history[idx];
    if (r.timestamp <= lastSentTs) continue;
    char item[64];
    snprintf(item, sizeof(item), "%s[%lld,%d,%.2f,%.1f]", n ? "," : "", (long long)r.timestamp, (int)r.co2, r.temp, r.hum);
    body += item;
    newest = r.timestamp;
    n++;
  }
  body += "]}";
  if (n == 0) {
    uploadPending = false;
    return;
  }

  time_t now;
  time(&now);
  char ts[16];
  snprintf(ts, sizeof(ts), "%lld", (long long)now);
  char sig[65];
  hmacSha256Hex(deviceSecret, String(DEVICE_ID) + "\n" + ts + "\n" + body, sig);

  WiFiClientSecure client;
  client.useBuiltinCACertBundle();
  HTTPClient http;
  http.begin(client, String(API_BASE) + "/api/device/readings");
  http.setTimeout(API_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Timestamp", ts);
  http.addHeader("X-Signature", sig);

  int code = http.POST(body);
  String reply = http.getString();
  http.end();

  if (code == 200) {
    uploadPending = false;
    lastSentTs = newest;
    prefs.putLong64("lastSent", lastSentTs);
    Serial.printf("API: uploaded %d reading(s)\n", n);
    otaMarkGood();   // a successful upload is the health check for a newly installed build
    handleServerReply(reply);
  } else {
    Serial.printf("API: upload failed (%d) %s; will retry\n", code, reply.c_str());
    if (code == 401 && reply.indexOf("\"enroll\"") >= 0) {   // staff reset our credential
      enrolled = false;
      devPrefs.putBool("enrolled", false);
    }
    if (code == 401 && reply.indexOf("bad_timestamp") >= 0) configTime(0, 0, "pool.ntp.org");
  }
}

void handleServerReply(const String& reply) {
  JsonDocument doc;
  if (deserializeJson(doc, reply)) return;
  if (!serverAnswered) {
    serverAnswered = true;
    devPrefs.putBool("answered", true);
  }
  bool isClaimed = doc["claimed"] | false;
  const char* name = doc["name"] | "";
  if (isClaimed != claimed) {
    claimed = isClaimed;
    devPrefs.putBool("claimed", claimed);
  }
  // The OLED font is plain ASCII: keep printable characters, turn anything else into '?'
  char clean[NAME_MAX_LEN + 1];
  size_t k = 0;
  for (const unsigned char* p = (const unsigned char*)name; *p && k < NAME_MAX_LEN; p++) {
    if (*p >= 0x80) { while ((p[1] & 0xC0) == 0x80) p++; clean[k++] = '?'; }   // skip UTF-8 continuation bytes
    else if (*p >= 0x20) clean[k++] = *p;
  }
  clean[k] = '\0';
  if (strcmp(clean, displayName) != 0) {
    strlcpy(displayName, clean, sizeof(displayName));
    devPrefs.putString("name", displayName);
    Serial.printf("API: name is now \"%s\"\n", displayName);
  }
  JsonVariant ota = doc["ota"];
  if (!ota.isNull()) {
    int version = ota["version"] | 0;
    const char* url = ota["url"] | "";
    const char* sha = ota["sha256"] | "";
    if (version > 0 && url[0] && strlen(sha) == 64) otaInstall(version, url, sha);
  }
}

// ================= OTA updates =================
// Flow: when an upload reply offers a build, the .bin is downloaded, its SHA-256 checked, and
// it is written to the spare app partition; the device reboots into it in "trial" mode.
// The new build is kept only once it uploads to the platform successfully.
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

// Downloads a build offered by the server into the spare app partition, checking its SHA-256
// before switching to it. Forced versions may be older than the running one (a rollback).
void otaInstall(int version, const char* url, const char* expectedSha) {
  if (otaTrial || WiFi.status() != WL_CONNECTED) return;
  if (version == FW_VERSION) return;
  if (version == otaPrefs.getInt("badVer", 0)) {
    Serial.println("OTA: that version was rolled back before; skipping");
    return;
  }
  Serial.printf("OTA: running v%d, server offers v%d\n", FW_VERSION, version);

  if (oledOK) {
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 20);
    display.println("Updating..");
    display.display();
  }
  saveHistoryToFlash();

  WiFiClientSecure client;
  client.useBuiltinCACertBundle();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);   // GitHub Release assets redirect
  http.begin(client, url);
  http.setTimeout(20000);
  int code = http.GET();
  int len = http.getSize();
  if (code != 200 || len <= 0) {
    Serial.printf("OTA: download failed (%d)\n", code);
    http.end();
    return;
  }
  if (!Update.begin(len, U_FLASH)) {
    Serial.printf("OTA: not enough space (%s)\n", Update.errorString());
    http.end();
    return;
  }

  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[1024];
  int written = 0;
  unsigned long lastData = millis();
  while (written < len && millis() - lastData < 20000) {
    size_t avail = stream->available();
    if (!avail) { delay(5); continue; }
    int got = stream->readBytes(buf, min(avail, sizeof(buf)));
    if (got <= 0) continue;
    mbedtls_md_update(&ctx, buf, got);
    if (Update.write(buf, got) != (size_t)got) break;
    written += got;
    lastData = millis();
  }
  http.end();

  uint8_t digest[32];
  mbedtls_md_finish(&ctx, digest);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);
  hex[64] = '\0';

  if (written != len || strcasecmp(hex, expectedSha) != 0) {
    Serial.printf("OTA: rejected (got %d of %d bytes, sha %s)\n", written, len, hex);
    Update.abort();
    return;
  }
  if (!Update.end(true)) {
    Serial.printf("OTA: finalize failed (%s)\n", Update.errorString());
    return;
  }
  otaPrefs.putBool("trial", true);
  otaPrefs.putInt("boots", 0);
  Serial.printf("OTA: v%d installed and verified, rebooting\n", version);
  delay(200);
  ESP.restart();
}

// ================= Device setup: QR code, WiFi =================
// First boot (or after holding BOOT for 5 s): the device opens its own setup network and
// shows a QR code on the OLED. Scanning it with a phone camera joins that network, and the
// phone pops up the setup page: pick home WiFi, Save. Naming happens in the portal.

const char SETUP_HELP_HTML[] =
  "<p>Choose your home WiFi and enter its password. 2.4 GHz networks only.</p>"
  "<p>Then give this sensor a room name in the <b>CO2 &amp; You</b> app at cobsci.com.</p>";

WiFiManagerParameter paramHelp(SETUP_HELP_HTML);

void loadSetupSettings() {
  setupPrefs.begin("setup", false);

  String pw = setupPrefs.getString("apPass", "");
  if (pw.length() < 8) {
    // No look-alike characters (0/o, 1/l/i) so it can also be typed from the screen
    const char* chars = "abcdefghjkmnpqrstuvwxyz23456789";
    char buf[9];
    for (int i = 0; i < 8; i++) buf[i] = chars[esp_random() % strlen(chars)];
    buf[8] = '\0';
    pw = buf;
    setupPrefs.putString("apPass", pw);
  }
  strlcpy(apPassword, pw.c_str(), sizeof(apPassword));

  // Location typed into the old setup page, if any: offered to the portal as a room name.
  String l = setupPrefs.getString("loc", "");
  if (l.length() && l != "unassigned") strlcpy(legacyLocation, l.c_str(), sizeof(legacyLocation));
}

// ---- OLED setup screens ----
int qrOffsetX = 0, qrOffsetY = 0;

void drawQrOnDisplay(esp_qrcode_handle_t qr) {
  int size = esp_qrcode_get_size(qr);
  int scale = (size * 2 <= 60) ? 2 : 1;
  int px = size * scale;
  // QR scanners expect dark modules on a light background with a margin, so draw a white panel
  display.fillRect(qrOffsetX, qrOffsetY, 64, 64, SSD1306_WHITE);
  int ox = qrOffsetX + (64 - px) / 2;
  int oy = qrOffsetY + (64 - px) / 2;
  for (int y = 0; y < size; y++)
    for (int x = 0; x < size; x++)
      if (esp_qrcode_get_module(qr, x, y))
        display.fillRect(ox + x * scale, oy + y * scale, scale, scale, SSD1306_BLACK);
}

void showSetupQrScreen() {
  if (!oledOK) return;
  // Standard WiFi QR format, understood by the iPhone and Android camera apps
  char payload[80];
  snprintf(payload, sizeof(payload), "WIFI:T:WPA;S:%s;P:%s;;", apName, apPassword);

  display.clearDisplay();
  qrOffsetX = 0; qrOffsetY = 0;
  esp_qrcode_config_t cfg = { drawQrOnDisplay, 3, ESP_QRCODE_ECC_LOW };   // version 3 = 29x29, fits at 2x
  esp_qrcode_generate(&cfg, payload);

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(70, 4);  display.println("SETUP");
  display.setCursor(70, 22); display.println("Scan with");
  display.setCursor(70, 32); display.println("phone");
  display.setCursor(70, 42); display.println("camera");
  display.display();
}

void showSetupTextScreen() {
  if (!oledOK) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);  display.println("No camera? Join WiFi:");
  display.setCursor(0, 12); display.println(apName);
  display.setCursor(0, 26); display.println("Password:");
  display.setCursor(0, 36); display.println(apPassword);
  display.setCursor(0, 52); display.println("Open 192.168.4.1");
  display.display();
}

void showMessage(const char* line1, const char* line2) {
  if (!oledOK) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 16); display.println(line1);
  display.setCursor(0, 32); display.println(line2);
  display.display();
}

// Connects to saved WiFi, or runs the setup portal until the customer finishes.
void connectWiFiWithSetupPortal() {
  bool forceSetup = setupPrefs.getBool("force", false);
  if (forceSetup) setupPrefs.putBool("force", false);

  WiFiManager wm;
  wm.setTitle("CO2 &amp; You Setup");
  std::vector<const char*> menu = {"wifi"};
  wm.setMenu(menu);
  wm.addParameter(&paramHelp);
  wm.setBreakAfterConfig(true);        // close the portal after Save
  wm.setConfigPortalBlocking(false);   // lets the OLED alternate screens while waiting
  if (otaTrial) wm.setConfigPortalTimeout(120);  // new build can't get online -> restart -> counts toward rollback

  bool connected;
  if (forceSetup) {
    Serial.println("Setup requested with BOOT button");
    wm.startConfigPortal(apName, apPassword);
    connected = false;
  } else {
    connected = wm.autoConnect(apName, apPassword);
  }

  if (connected) return;

  Serial.printf("Setup portal open. WiFi: %s  Password: %s\n", apName, apPassword);
  unsigned long lastSwap = 0;
  bool qrShown = false;
  while (true) {
    wm.process();
    otaTrialTick();

    if (!wm.getConfigPortalActive()) {
      if (WiFi.status() == WL_CONNECTED) {
        showMessage("Setup complete!", "Connected to WiFi");
        delay(2000);
        if (forceSetup) {           // reboot so the new WiFi settings take effect cleanly
          saveHistoryToFlash();
          ESP.restart();
        }
        return;
      }
      // Saved without WiFi, WiFi failed, or timed out: reboot and try the saved network
      showMessage("Restarting...", "");
      delay(1000);
      ESP.restart();
    }

    if (millis() - lastSwap > 8000 || lastSwap == 0) {
      lastSwap = millis();
      qrShown = !qrShown;
      if (qrShown) showSetupQrScreen(); else showSetupTextScreen();
    }
    delay(10);
  }
}

// Hold BOOT for 5 s while running to reopen setup (new WiFi).
// Returns true while it is drawing on the OLED.
bool checkSetupButton() {
  if (digitalRead(SETUP_BUTTON_PIN) != LOW) {
    setupButtonDownSince = 0;
    return false;
  }
  if (setupButtonDownSince == 0) setupButtonDownSince = millis();
  unsigned long held = millis() - setupButtonDownSince;
  if (held < 1000) return false;

  if (held < SETUP_HOLD_MS) {
    char buf[24];
    snprintf(buf, sizeof(buf), "Keep holding... %lu", (SETUP_HOLD_MS - held) / 1000 + 1);
    showMessage("Setup mode", buf);
    return true;
  }

  showMessage("Release button", "to start setup");
  while (digitalRead(SETUP_BUTTON_PIN) == LOW) delay(20);   // restart only after release
  setupPrefs.putBool("force", true);
  saveHistoryToFlash();
  delay(200);
  ESP.restart();
  return true;
}
