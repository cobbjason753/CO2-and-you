-- Phones and browsers that turned on push notifications in the portal (one row per device/browser).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint        text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures        int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id);
