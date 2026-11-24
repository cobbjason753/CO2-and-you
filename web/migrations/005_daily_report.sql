-- Daily house report (format from the CO2-and-you-reports repo), sent by the platform.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_report boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS daily_reports (
  house_id    text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  local_date  date NOT NULL,           -- the house's local date the report was sent for
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, local_date)
);
