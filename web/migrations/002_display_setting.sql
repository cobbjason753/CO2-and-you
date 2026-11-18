-- Customer setting: sensor screen and LED on/off (sent to the device with each upload reply).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_on boolean NOT NULL DEFAULT true;
