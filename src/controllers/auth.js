// 사회자 인증. 비밀번호(.env ADMIN_PASSWORD)를 맞히면 서명된 토큰을 준다.
// 토큰 = "발급시각.서명" — 서버를 다시 켜도 유효하다. 비밀번호를 바꾸면 기존 토큰은 모두 무효.
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { log } from '../logger.js';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
const fails = new Map(); // ip → { count, until }

const password = () => process.env.ADMIN_PASSWORD ?? '';
const sign = (issued) => createHmac('sha256', password()).update(String(issued)).digest('base64url');

function safeEqual(a, b) {
  // 길이가 달라도 같은 시간이 걸리도록 해시끼리 비교
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function issueToken() {
  const issued = Date.now();
  return `${issued}.${sign(issued)}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [issued, sig] = String(token).split('.');
  const t = Number(issued);
  if (!t || !sig || Date.now() - t > TOKEN_TTL_MS) return false;
  return safeEqual(sig, sign(t));
}

export function tokenFromReq(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// POST /api/login { password }
export function login({ ip, body, reqId }) {
  const f = fails.get(ip);
  if (f && f.until > Date.now()) {
    log.warn('로그인 잠김 상태에서 재시도', { reqId, ip });
    return { status: 429, body: { error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil((f.until - Date.now()) / 1000)}초 뒤에 다시 시도하세요.` } };
  }
  if (typeof body?.password !== 'string' || !safeEqual(body.password, password())) {
    const count = (f && f.until && f.until <= Date.now() ? 0 : f?.count ?? 0) + 1;
    fails.set(ip, { count, until: count >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    log.warn('로그인 실패 — 비밀번호 불일치', { reqId, ip, count });
    return { status: 401, body: { error: '비밀번호가 맞지 않습니다.' } };
  }
  fails.delete(ip);
  log.info('사회자 로그인', { reqId, ip });
  return { status: 200, body: { token: issueToken() } };
}
