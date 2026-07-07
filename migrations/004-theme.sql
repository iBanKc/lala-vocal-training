-- ธีมส่วนตัวของผู้ใช้ ('' = มาตรฐาน, 'boy', 'girl') — เลือกจาก hub สลับได้ตลอด
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT '';
