import { neon } from '@neondatabase/serverless';

// สำหรับ local dev บนเครือข่ายที่ RTT ไป us-east-1 สูงกว่า Happy-Eyeballs
// timeout เริ่มต้นของ Node (250ms) — บน Vercel จริงไม่มีผล
try {
  const net = await import('node:net');
  net.setDefaultAutoSelectFamilyAttemptTimeout?.(3000);
} catch { /* runtime ที่ไม่มี node:net */ }

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is not set — provision Neon via Vercel Storage and run `vercel env pull .env.local`');

export const sql = neon(url);
