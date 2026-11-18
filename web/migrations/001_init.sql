-- CO2 & You platform schema. Postgres 14+ (Neon, Supabase or local).

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  name            text NOT NULL DEFAULT '',
  password_hash   text,                       -- null until the welcome / invite link is used
  role            text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  totp_secret     text,
  totp_enabled    boolean NOT NULL DEFAULT false,
  temp_unit       text NOT NULL DEFAULT 'F' CHECK (temp_unit IN ('F','C')),
  weekly_report   boolean NOT NULL DEFAULT true,
  stripe_customer_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id_hash         text PRIMARY KEY,           -- sha256 of the cookie value
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_ok          boolean NOT NULL DEFAULT false,
  current_house_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One-time links: set password (welcome), reset password, household invite
CREATE TABLE tokens (
  id_hash         text PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('set_password','reset_password','invite')),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  email           text,
  data            jsonb NOT NULL DEFAULT '{}',
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE houses (
  id              text PRIMARY KEY,           -- HOUSE_ID, random
  name            text NOT NULL DEFAULT 'My home',
  timezone        text NOT NULL DEFAULT 'America/New_York',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE house_members (
  house_id        text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner','viewer')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, user_id)
);
CREATE INDEX house_members_user ON house_members (user_id);

CREATE TABLE rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id        text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_house ON rooms (house_id);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          serial UNIQUE,
  source          text NOT NULL DEFAULT 'manual',   -- stripe | manual
  external_id     text UNIQUE,                      -- Stripe checkout session id
  payment_intent  text,
  email           text NOT NULL,                    -- buyer
  customer_name   text NOT NULL DEFAULT '',
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,   -- account that will own the devices
  house_id        text REFERENCES houses(id) ON DELETE SET NULL,  -- null = customer must choose
  status          text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','shipped','cancelled','refunded')),
  device_qty      int NOT NULL,
  items           jsonb NOT NULL DEFAULT '[]',
  is_gift         boolean NOT NULL DEFAULT false,
  gift_email      text,
  gift_name       text,
  ship_to         jsonb NOT NULL DEFAULT '{}',
  tracking        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  shipped_at      timestamptz
);

CREATE TABLE devices (
  id              text PRIMARY KEY,                -- DEVICE_ID, esp32-<MAC>
  claim_code_hash text NOT NULL,
  claim_code_hint text NOT NULL,                   -- last 4 characters, for staff
  claim_used_at   timestamptz,
  secret_enc      text,                            -- per-device signing key (AES-GCM); null = enrolls on first contact
  secret_set_at   timestamptz,
  status          text NOT NULL DEFAULT 'in_stock'
                  CHECK (status IN ('in_stock','assigned','returned','defective','revoked')),
  test_result     text NOT NULL CHECK (test_result IN ('pass','fail')),
  fw_provisioned  int,
  fw_version      int,
  house_id        text REFERENCES houses(id) ON DELETE SET NULL,
  room_id         uuid REFERENCES rooms(id) ON DELETE SET NULL,
  order_id        uuid REFERENCES orders(id) ON DELETE SET NULL,
  assigned_at     timestamptz,
  pilot           boolean NOT NULL DEFAULT false,  -- firmware early-rollout group
  target_fw       int,                             -- staff-forced firmware version
  legacy_location text,                            -- name typed into the old on-device setup page
  last_seen_at    timestamptz,
  last_rssi       int,
  last_reading_at timestamptz,
  last_co2        int,
  last_temp_c     real,
  last_humidity   real,
  ingest_errors   int NOT NULL DEFAULT 0,          -- consecutive rejected uploads
  last_error      text,
  last_error_at   timestamptz,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_house ON devices (house_id);

CREATE TABLE order_units (
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  device_id       text NOT NULL REFERENCES devices(id),
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  scanned_by      uuid REFERENCES users(id),
  PRIMARY KEY (order_id, device_id)
);

-- Who held each device when (transfers, swaps, resale)
CREATE TABLE device_assignments (
  id              bigserial PRIMARY KEY,
  device_id       text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  house_id        text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  how             text NOT NULL                    -- packing | claim | staff
);

-- Readings carry the house and room they were recorded in, so history stays put
-- when a device moves room or changes hands.
CREATE TABLE readings (
  device_id       text NOT NULL,
  time            timestamptz NOT NULL,
  house_id        text NOT NULL,
  room_id         uuid,
  co2             int NOT NULL,
  temp_c          real NOT NULL,
  humidity        real NOT NULL,
  PRIMARY KEY (device_id, time)
);
CREATE INDEX readings_house_time ON readings (house_id, time);

CREATE TABLE unknown_devices (
  device_id       text PRIMARY KEY,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  attempts        int NOT NULL DEFAULT 1,
  fw_version      int,
  last_ip         text,
  legacy_location text
);

CREATE TABLE subscriptions (
  id              text PRIMARY KEY,                -- Stripe subscription id, or manual-<uuid>
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL,                   -- active | trialing | past_due | canceled | ...
  plan            text NOT NULL DEFAULT 'standard',
  current_period_end timestamptz,
  canceled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id        text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id         uuid REFERENCES rooms(id) ON DELETE CASCADE,   -- null = whole house
  kind            text NOT NULL CHECK (kind IN ('co2','offline')),
  threshold       int NOT NULL,                    -- ppm, or hours for offline
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX alert_rules_scope ON alert_rules (house_id, kind, coalesce(room_id::text, ''));

CREATE TABLE alert_events (
  id              bigserial PRIMARY KEY,
  house_id        text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  device_id       text NOT NULL,
  room_id         uuid,
  kind            text NOT NULL,
  value           real,
  threshold       int,
  started_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  notified_at     timestamptz
);
CREATE INDEX alert_events_open ON alert_events (device_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX alert_events_house ON alert_events (house_id, started_at DESC);

CREATE TABLE firmware_releases (
  version         int PRIMARY KEY,
  url             text,                            -- external .bin (e.g. GitHub Release); null when uploaded
  bin_data        bytea,                           -- uploaded .bin
  size_bytes      int,
  sha256          text NOT NULL,
  stage           text NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft','pilot','general','retired')),
  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_requests (
  id              bigserial PRIMARY KEY,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  house_id        text,
  email           text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  context         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'open',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid,
  actor_email     text,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  details         jsonb NOT NULL DEFAULT '{}',
  ip              text
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
CREATE INDEX audit_log_target ON audit_log (target_type, target_id);

CREATE TABLE email_outbox (
  id              bigserial PRIMARY KEY,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  html            text NOT NULL,
  text_body       text NOT NULL,
  kind            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  provider_id     text,
  error           text
);

-- Fixed-window rate limits (claim attempts, logins, ingest)
CREATE TABLE rate_limits (
  key             text PRIMARY KEY,
  window_start    timestamptz NOT NULL,
  count           int NOT NULL
);

CREATE TABLE weekly_reports (
  house_id        text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, week_start)
);
