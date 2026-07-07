-- ค่าตั้งของแอปที่ครูแก้ได้จากหน้า admin (เช่น ลิงก์ช่องทางติดต่อใน "เกี่ยวกับเรา")
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT INTO app_settings (key, value) VALUES
  ('contact_line', ''),
  ('contact_facebook', ''),
  ('contact_maps', '')
ON CONFLICT (key) DO NOTHING;
