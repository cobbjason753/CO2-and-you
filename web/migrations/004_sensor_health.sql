-- Sensor health reported by firmware v10+ with every check-in ("ok", "no_data", "missing"),
-- and the device's note about its last problem (failed enroll/upload, rollback).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sensor_state text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_note text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_note_at timestamptz;
