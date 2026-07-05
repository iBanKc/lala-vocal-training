import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is not set — provision Neon via Vercel Storage and run `vercel env pull .env.local`');

export const sql = neon(url);
