// /api/* 라우팅. 로그인 외 모든 API 는 토큰이 필요하다.
import { login, verifyToken, tokenFromReq } from '../controllers/auth.js';
import { getState, putState } from '../controllers/state.js';
import { log } from '../logger.js';

const MAX_BODY = 10 * 1024 * 1024; // 되돌리기 기록까지 담기에 충분

const routes = [
  { method: 'POST', path: /^\/api\/login$/, handler: login, open: true },
  { method: 'GET', path: /^\/api\/session$/, handler: () => ({ status: 200, body: { ok: true } }) },
  { method: 'GET', path: /^\/api\/state\/(?<doc>[a-z]+)$/, handler: getState },
  { method: 'PUT', path: /^\/api\/state\/(?<doc>[a-z]+)$/, handler: putState },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) { resolve(null); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch {
        reject(Object.assign(new Error('JSON 형식이 아닙니다.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function handleApi(req, res, reqId) {
  const pathname = new URL(req.url, 'http://x').pathname;
  const sameRoute = routes.filter((r) => r.path.test(pathname));
  const route = sameRoute.find((r) => r.method === req.method);
  if (!route) {
    send(res, sameRoute.length ? 405 : 404, { error: sameRoute.length ? '허용되지 않는 메서드입니다.' : '없는 API 입니다.' });
    return;
  }
  if (!route.open && !verifyToken(tokenFromReq(req))) {
    log.warn(`인증 필요 ${req.method} ${pathname}`, { reqId });
    send(res, 401, { error: '사회자 로그인이 필요합니다.' });
    return;
  }
  try {
    const body = req.method === 'GET' ? null : await readBody(req);
    log.debug('API 요청', { reqId, bytes: req.headers['content-length'] ?? 0 });
    const params = pathname.match(route.path).groups ?? {};
    const out = await route.handler({ req, params, body, reqId, ip: req.socket.remoteAddress });
    send(res, out.status, out.body);
  } catch (err) {
    if (err.status) { send(res, err.status, { error: err.message }); return; }
    log.error(`API 처리 실패 ${req.method} ${pathname}`, { reqId, err: err.stack });
    send(res, 500, { error: '서버 오류가 났습니다.' });
  }
}
