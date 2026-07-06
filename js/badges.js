// ข้อมูลแสดงผล badge + ชื่อระดับ (ตรรกะการให้อยู่ฝั่ง server: api/_lib/gamification.js)

export const BADGE_INFO = {
  first_step:    { emoji: '🐣', name: 'ก้าวแรก',        desc: 'เล่นจบรอบแรก' },
  streak_3:      { emoji: '🔥', name: 'ไฟติด 3 วัน',     desc: 'ฝึกติดต่อกัน 3 วัน' },
  streak_7:      { emoji: '⚡', name: 'สัปดาห์ทอง',      desc: 'ฝึกติดต่อกัน 7 วัน' },
  streak_30:     { emoji: '🏆', name: 'เดือนแห่งเสียง',   desc: 'ฝึกติดต่อกัน 30 วัน' },
  xp_1000:       { emoji: '💎', name: 'นักสะสม XP',      desc: 'สะสมครบ 1,000 XP' },
  xp_5000:       { emoji: '👑', name: 'ราชา XP',         desc: 'สะสมครบ 5,000 XP' },
  perfect_score: { emoji: '💯', name: 'เพอร์เฟกต์!',      desc: 'ได้คะแนน 98 ขึ้นไป' },
  three_stars:   { emoji: '🌟', name: 'สามดาวแรก',       desc: 'ได้ 3 ดาวครั้งแรก' },
  all_games:     { emoji: '🎪', name: 'ลองครบทุกเกม',    desc: 'เล่นครบทั้ง 5 เกม' },
  song_master:   { emoji: '🎤', name: 'นักร้องตัวจริง',   desc: 'ร้องเพลงเต็มได้ 80+' },
  sessions_50:   { emoji: '🎓', name: 'ขยันฝึก',         desc: 'ฝึกครบ 50 รอบ' },
  hold_15:       { emoji: '🫁', name: 'ปอดเหล็ก',        desc: 'ลากเสียงนิ่งครบ 12 วินาที' },
  book_worm:     { emoji: '📖', name: 'ศิษย์เสียงใหม่',   desc: 'ฝึกครบทุกแบบฝึกจากหนังสือ เสียงใหม่ฯ' },
};

export const LEVEL_TITLES = [
  '', 'นักร้องฝึกหัด', 'เสียงใส', 'ดาวรุ่ง', 'นักร้องประจำบ้าน', 'เสียงทอง',
  'โปร', 'ดีว่า', 'ซุปเปอร์สตาร์', 'ตำนาน', 'ราชา/ราชินีเสียงเพลง',
];

export function levelTitle(level) {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)];
}
