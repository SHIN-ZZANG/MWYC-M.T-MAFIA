// 설정 · 게임 상태 읽기/쓰기
import { readDoc, writeDoc, isDoc } from '../storage.js';
import { log } from '../logger.js';

// GET /api/state/:doc
export async function getState({ params }) {
  if (!isDoc(params.doc)) return { status: 404, body: { error: '없는 문서입니다.' } };
  return { status: 200, body: await readDoc(params.doc) };
}

// PUT /api/state/:doc { baseVersion, data }
export async function putState({ params, body, reqId }) {
  const { doc } = params;
  if (!isDoc(doc)) return { status: 404, body: { error: '없는 문서입니다.' } };
  if (!body || typeof body !== 'object' || !Number.isInteger(body.baseVersion) || !('data' in body)) {
    return { status: 400, body: { error: 'baseVersion(정수)과 data 가 필요합니다.' } };
  }
  if (doc === 'settings' && (typeof body.data !== 'object' || !Array.isArray(body.data?.roles))) {
    return { status: 400, body: { error: '설정 형식이 올바르지 않습니다(roles 없음).' } };
  }
  const r = await writeDoc(doc, body.baseVersion, body.data);
  if (!r.ok) {
    log.warn(`저장 충돌 ${doc} — 다른 창에서 먼저 저장됨`, { reqId, base: body.baseVersion, current: r.current.version });
    return { status: 409, body: { error: '다른 창이나 PC에서 먼저 저장했습니다.', current: r.current } };
  }
  log.debug(`저장 ${doc}`, { reqId, version: r.version });
  return { status: 200, body: { version: r.version, updatedAt: r.updatedAt } };
}
