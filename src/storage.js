// 파일 저장소. DATA_DIR 아래에 문서 하나당 JSON 파일 하나를 둔다.
//  파일 내용: { version, updatedAt, data }
//  version 은 저장할 때마다 1 씩 오른다. 클라이언트가 보낸 baseVersion 과 다르면 덮어쓰지 않는다(다른 창에서 먼저 저장됨).
import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DOCS = new Set(['settings', 'game']);
const locks = new Map(); // 문서별 쓰기 순서 보장

const fileOf = (doc) => path.join(DATA_DIR, `${doc}.json`);

export async function initStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // 쓰기 권한 확인
  const probe = path.join(DATA_DIR, '.write-test');
  await fs.writeFile(probe, 'ok');
  await fs.rm(probe);
}

export function isDoc(doc) {
  return DOCS.has(doc);
}

export async function readDoc(doc) {
  try {
    const raw = await fs.readFile(fileOf(doc), 'utf8');
    const parsed = JSON.parse(raw);
    return { version: Number(parsed.version) || 0, updatedAt: parsed.updatedAt ?? null, data: parsed.data ?? null };
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 0, updatedAt: null, data: null };
    log.error(`저장 파일 읽기 실패 ${fileOf(doc)}`, { err: err.stack });
    throw err;
  }
}

// 성공: { ok: true, version } / 버전 충돌: { ok: false, current }
export function writeDoc(doc, baseVersion, data) {
  const prev = locks.get(doc) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(async () => {
    const current = await readDoc(doc);
    if (Number(baseVersion) !== current.version) return { ok: false, current };
    const next = { version: current.version + 1, updatedAt: new Date().toISOString(), data };
    const file = fileOf(doc);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next), 'utf8');
    await fs.rename(tmp, file); // 쓰다가 꺼져도 기존 파일이 깨지지 않게
    return { ok: true, version: next.version, updatedAt: next.updatedAt };
  });
  locks.set(doc, task);
  return task;
}
