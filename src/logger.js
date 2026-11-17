// 공용 로거. 서버 코드에서는 console.log 를 직접 쓰지 않고 이 모듈만 쓴다.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const isDev = process.argv.includes('--dev');
const levelName = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');
const current = LEVELS[levelName] ?? LEVELS.info;

export const logLevel = Object.keys(LEVELS).find((k) => LEVELS[k] === current);

function write(level, msg, extra) {
  if (LEVELS[level] > current) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] ${msg}`
    + (extra ? ' ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ') : '');
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  error: (msg, extra) => write('error', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  info: (msg, extra) => write('info', msg, extra),
  debug: (msg, extra) => write('debug', msg, extra),
};
