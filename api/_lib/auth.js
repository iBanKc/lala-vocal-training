import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export async function signToken(user, expiresIn = '30d') {
  return new SignJWT({ role: user.role, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

// คืน { userId, role, username } หรือ null ถ้า token ใช้ไม่ได้
export async function getAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: Number(payload.sub), role: payload.role, username: payload.username };
  } catch {
    return null;
  }
}

// ตอบ 401 เองถ้าไม่ผ่าน — caller แค่เช็ค null แล้ว return
export async function requireAuth(req, res) {
  const auth = await getAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    return null;
  }
  return auth;
}

export async function requireTeacher(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (auth.role !== 'teacher') {
    res.status(403).json({ error: 'เฉพาะครูเท่านั้น' });
    return null;
  }
  return auth;
}
