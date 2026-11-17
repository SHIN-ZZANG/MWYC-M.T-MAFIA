// 사회자 콘솔 서버. public/ 정적 서빙 + /api (설정 · 게임 상태를 DATA_DIR 의 JSON 파일에 저장).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// .env 가 있으면 읽는다(Node 20.12+). 이미 설정된 환경변수는 덮어쓰지 않는다.
if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { log, logLevel } = await import('./logger.js');
const { initStorage, DATA_DIR } = await import('./storage.js');
const { handleApi } = await import('./routes/api.js');

// 사회자 비밀번호가 없으면 아무나 역할을 조회할 수 있으므로 서버를 띄우지 않는다
if (!process.env.ADMIN_PASSWORD) {
  log.error('ADMIN_PASSWORD 가 설정되지 않았습니다. .env 에 ADMIN_PASSWORD=비밀번호 를 넣고 다시 실행하세요. (.env.example 참고)');
  process.exit(1);
}

try {
  await initStorage();
} catch (err) {
  log.error(`데이터 폴더를 쓸 수 없습니다: ${DATA_DIR}. 폴더 권한이나 DATA_DIR 값을 확인하세요.`, { err: err.stack });
  process.exit(1);
}

const PUBLIC_DIR = path.join(process.cwd(), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// ── 포트 결정: CLI --port > PORT > 기본값 3000 ─────────────────
function resolvePort() {
  const idx = process.argv.indexOf('--port');
  let raw; let source;
  if (idx !== -1) { raw = process.argv[idx + 1]; source = 'CLI 인자(--port)'; }
  else if (process.env.PORT !== undefined && process.env.PORT !== '') { raw = process.env.PORT; source = '환경변수(PORT)'; }
  else { return { port: 3000, source: '기본값' }; }

  const port = Number(raw);
  if (!/^\d+$/.test(String(raw)) || port < 1 || port > 65535) {
    log.error(`잘못된 포트 값입니다: "${raw}" (${source}). 1~65535 사이 정수를 지정하세요.`);
    process.exit(1);
  }
  return { port, source };
}

const { port: PORT, source: portSource } = resolvePort();
const HOST = process.env.HOST || '0.0.0.0';

function serveStatic(req, res, reqId) {
  let reqPath;
  try {
    reqPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    log.warn(`경로 탈출 시도 차단 ${reqPath}`, { reqId });
    res.writeHead(403).end('Forbidden');
    return;
  }

  // 디렉터리면 index.html, "/settings" 처럼 끝 슬래시가 없으면 붙여서 리다이렉트
  try {
    const st = fs.statSync(filePath);
    if (st.isDirectory()) {
      if (!reqPath.endsWith('/')) {
        res.writeHead(301, { Location: reqPath + '/' }).end();
        return;
      }
      filePath = path.join(filePath, 'index.html');
    }
  } catch { /* 아래에서 404 처리 */ }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        log.warn(`파일 없음 ${reqPath}`, { reqId });
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      } else {
        log.error(`정적 파일 읽기 실패 ${reqPath}`, { reqId, err: err.stack });
        res.writeHead(500).end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const reqId = randomUUID().slice(0, 8);
  const start = Date.now();
  res.setHeader('X-Request-Id', reqId);

  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.url} ${res.statusCode} ${ms}ms`, { reqId });
    log.debug('요청 상세', {
      reqId, ip: req.socket.remoteAddress, ua: JSON.stringify(req.headers['user-agent'] ?? ''),
    });
  });

  try {
    if (req.url.startsWith('/api/')) {
      handleApi(req, res, reqId).catch((err) => {
        log.error(`API 처리 실패 ${req.method} ${req.url}`, { reqId, err: err.stack });
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
      return;
    }
    serveStatic(req, res, reqId);
  } catch (err) {
    log.error(`요청 처리 실패 ${req.method} ${req.url}`, { reqId, err: err.stack });
    if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`포트 ${PORT} 가 이미 사용 중입니다. 다른 프로그램을 끄거나 "npm start -- --port 3001" 처럼 다른 포트로 실행하세요.`);
  } else if (err.code === 'EACCES') {
    log.error(`포트 ${PORT} 를 열 권한이 없습니다. 1024 이상 포트를 쓰거나 관리자 권한으로 실행하세요.`);
  } else {
    log.error('서버 오류', { err: err.stack });
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { err: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { err: reason?.stack ?? String(reason) });
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT}`, { source: portSource });
  log.info('서버 정보', {
    host: HOST,
    mode: process.env.NODE_ENV ?? 'development',
    node: process.version,
    logLevel,
    public: PUBLIC_DIR,
    data: DATA_DIR,
  });
  if (HOST === '0.0.0.0') log.info(`이 노트북에서는 http://localhost:${PORT} 로 접속하세요.`);
});
