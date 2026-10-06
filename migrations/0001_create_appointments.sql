CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation TEXT NOT NULL,
  area_code TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  slot_label TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  symptom TEXT NOT NULL,
  booked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_confirmation
  ON appointments (confirmation);

