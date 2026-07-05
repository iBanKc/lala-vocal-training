-- รอบ 2: บัญชี guest สำหรับผู้เยี่ยมชมทั่วไป (ประชาสัมพันธ์โรงเรียน)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;
