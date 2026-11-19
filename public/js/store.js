// 저장소. 원본은 서버의 JSON 파일, 브라우저 localStorage 는 사본.
// localStorage 접근이 막혀 있어도(사생활 보호 모드 등) 화면은 동작하도록 try/catch 로 감싼다.
import { DEFAULT_SETTINGS, defaultOpts } from './defaults.js';
import { api, ensureLogin, ApiError, NetworkError } from './api.js';

const KEY_SETTINGS = 'mafia.settings';
const KEY_GAME = 'mafia.game';
const KEY_HISTORY = 'mafia.history';

const clone = (o) => JSON.parse(JSON.stringify(o));

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error(`[store] ${key} 읽기 실패`, err);
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[store] ${key} 저장 실패`, err);
    return false;
  }
}

// 예전 기본 문구를 그대로 쓰고 있으면 새 규칙(마담 · 마피아는 서로 모름) 문구로 바꾼다. 직접 고친 문구는 건드리지 않는다
const OLD_TEXTS = {
  mafia: {
    guide: ['마피아 팀입니다. 밤마다 서로 의논해서 한 명을 공격합니다.\n마담이 누구인지는 서로 압니다.'],
    nightScript: ['마피아는 고개를 들어 주세요. 서로 얼굴을 확인하고, 오늘 밤 죽일 사람을 한 명 지목해 주세요.'],
  },
  madam: { guide: [
    '마피아 팀입니다. 밤마다 한 명을 유혹해서 그 사람의 그날 밤 능력을 막습니다.',
    '마피아 팀입니다. 밤마다 한 명을 유혹해서 그 사람의 그날 밤 능력을 막습니다.\n마피아가 누구인지는 모릅니다. 마피아를 유혹하면 그날 밤 마피아 공격이 무효가 됩니다.\n경찰 조사 · 처형 · 마피아 공격으로 죽으면 시민으로 나옵니다(스나이퍼에게 죽으면 마피아, 기자에게는 마담).',
  ] },
  lovers: { guide: ['시민 팀입니다. 두 사람은 연인입니다.\n한 명이 마피아에게 죽으면 다른 한 명도 같이 죽습니다.'] },
};
function upgradeTexts(r, d) {
  const old = OLD_TEXTS[r.id];
  const def = d.roles.find((x) => x.id === r.id);
  if (!old || !def) return r;
  const out = { ...r };
  for (const [k, list] of Object.entries(old)) if (list.includes(r[k])) out[k] = def[k];
  return out;
}

const byName = (a, b) => a.localeCompare(b, 'ko');

// 저장된 설정에 빠진 항목이 있으면 기본값으로 채운다(버전이 올라가도 깨지지 않게).
export function normalizeSettings(s) {
  const d = clone(DEFAULT_SETTINGS);
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s, scripts: { ...d.scripts, ...(s.scripts ?? {}) } };
  out.roles = Array.isArray(s.roles) && s.roles.length ? s.roles : d.roles;
  // 예전 기본 멘트를 그대로 쓰고 있으면 새 멘트로
  if (out.scripts.nightKill === '밤사이 {name} 님이 마피아에게 살해당했습니다.') out.scripts.nightKill = d.scripts.nightKill;
  out.roles = out.roles.map((r) => upgradeTexts(r, d)).map((r) => ({
    ...r,
    count: Math.max(0, Number(r.count) || 0),
    opts: { ...defaultOpts(r.ability), ...(r.opts ?? {}) },
  }));
  out.discussionSec = Math.max(10, Number(out.discussionSec) || d.discussionSec);
  out.roster = uniqueNames(Array.isArray(s.roster) ? s.roster : []).sort(byName); // 명단은 가나다순
  // 공개 범위는 "마피아/시민만"으로 고정 — 예전 옵션 값은 버린다
  delete out.revealExecution;
  delete out.revealNightDeath;
  out.roles = sortRolesByTeam(out.roles);
  return out;
}

// 역할 배정 · 밤 호출 순서는 항상 마피아 팀 → 시민 팀. 팀 안에서는 기존 순서를 지킨다.
export { byName };

export const TEAM_ORDER = ['mafia', 'citizen'];
export function sortRolesByTeam(roles) {
  return TEAM_ORDER.flatMap((t) => roles.filter((r) => r.team === t))
    .concat(roles.filter((r) => !TEAM_ORDER.includes(r.team)));
}

// 이름 목록 정리: 앞뒤 공백 제거, 빈 값 · 중복 제거
export function uniqueNames(list) {
  const seen = new Set();
  const out = [];
  for (const n of list) {
    const name = String(n ?? '').trim();
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

// 붙여 넣은 글을 이름 여러 개로 나누기 (줄바꿈 · 쉼표 · 탭)
export function splitNames(text) {
  return String(text ?? '').split(/[\n,\t]/).map((s) => s.trim()).filter(Boolean);
}

// ── 서버 동기화 ───────────────────────────────────────────────
// 서버(data/*.json)가 원본이고, localStorage 는 화면을 바로 그리기 위한 사본(캐시)이다.
// 서버에 못 보낸 변경은 pending 으로 표시해 두고, 다시 연결되면 보낸다.
//  문서: settings = 설정 객체 / game = { game, history }
const KEY_META = 'mafia.sync';   // { ver: {settings, game}, pending: {settings, game} }
const savedMeta = read(KEY_META) ?? {};
const meta = {
  ver: { settings: 0, game: 0, ...(savedMeta.ver ?? {}) },
  pending: { settings: false, game: false, ...(savedMeta.pending ?? {}) },
};
// 다른 탭이 다른 문서를 저장했을 수 있으므로 해당 문서 정보만 갱신한다
function saveMeta(doc) {
  const m = read(KEY_META) ?? { ver: {}, pending: {} };
  m.ver[doc] = meta.ver[doc];
  m.pending[doc] = meta.pending[doc];
  write(KEY_META, m);
}

let handlers = { onConflict: null };
let retryTimer = null;

function localDoc(doc) {
  if (doc === 'settings') return read(KEY_SETTINGS);
  const game = read(KEY_GAME);
  return game ? { game, history: read(KEY_HISTORY) ?? [] } : null;
}
function setLocalDoc(doc, data) {
  if (doc === 'settings') { write(KEY_SETTINGS, data); return; }
  write(KEY_GAME, data?.game ?? null);
  write(KEY_HISTORY, data?.history ?? []);
}

// 화면 위쪽 #sync 표시
function status(state, text) {
  const el = typeof document !== 'undefined' && document.getElementById('sync');
  if (!el) return;
  el.className = `sync ${state}`;
  el.textContent = text;
  el.title = state === 'ok' ? '서버 파일에 저장됨' : text;
}

async function put(doc, data, baseVersion = meta.ver[doc]) {
  return api('PUT', `/api/state/${doc}`, { baseVersion, data });
}

const inFlight = { settings: null, game: null };
const again = { settings: false, game: false };

// 지금 캐시에 있는 내용을 서버로. 이미 보내는 중이면 끝난 뒤 한 번 더 보낸다.
async function push(doc) {
  if (inFlight[doc]) { again[doc] = true; return inFlight[doc]; }
  inFlight[doc] = (async () => {
    let result = { ok: true };
    do {
      again[doc] = false;
      try {
        status('saving', '저장 중…');
        const r = await put(doc, localDoc(doc));
        meta.ver[doc] = r.version;
        meta.pending[doc] = false;
        saveMeta(doc);
        status('ok', '저장됨');
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          status('error', '다른 곳에서 바뀜');
          result = { ok: false, conflict: true, current: err.body.current };
          await handlers.onConflict?.(doc, err.body.current);
          break;
        }
        console.error(`[store] ${doc} 서버 저장 실패`, err);
        status('error', err instanceof NetworkError ? '서버 연결 끊김 — 브라우저에만 저장 중' : `저장 실패: ${err.message}`);
        scheduleRetry();
        result = { ok: false, error: err };
        break;
      }
    } while (again[doc]);
    inFlight[doc] = null;
    return result;
  })();
  return inFlight[doc];
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    for (const doc of ['settings', 'game']) if (meta.pending[doc]) push(doc);
  }, 5000);
}

// 서버의 내용을 캐시로 받아들인다(다른 창 · PC 의 최신 상태)
export function adoptServer(doc, current) {
  setLocalDoc(doc, current?.data ?? null);
  meta.ver[doc] = current?.version ?? 0;
  meta.pending[doc] = false;
  saveMeta(doc);
}

// 페이지를 열 때 한 번: 로그인 → 서버 상태 받기(또는 기존 브라우저 데이터 올리기)
export async function initStore(opts = {}) {
  handlers = { ...handlers, ...opts };
  status('saving', '서버 연결 중…');
  try {
    await ensureLogin();
  } catch (err) {
    console.error('[store] 서버 연결 실패', err);
    status('error', '서버 연결 끊김 — 브라우저에만 저장 중');
    scheduleRetry();
    return { offline: true };
  }
  const notes = [];
  for (const doc of ['settings', 'game']) {
    try {
      const server = await api('GET', `/api/state/${doc}`);
      const local = localDoc(doc);
      if (server.version === 0) {
        // 서버가 비어 있으면 이 브라우저에 있던 데이터를 올린다(처음 한 번 옮기기)
        meta.ver[doc] = 0;
        if (local) { meta.pending[doc] = true; saveMeta(doc); await push(doc); }
      } else if (meta.pending[doc] && meta.ver[doc] === server.version && local) {
        // 연결이 끊긴 동안 여기서만 바뀐 내용 → 이어서 올린다
        await push(doc);
      } else {
        if (meta.pending[doc]) notes.push(doc === 'game' ? '게임 진행' : '설정');
        adoptServer(doc, server);
      }
    } catch (err) {
      console.error(`[store] ${doc} 불러오기 실패`, err);
      status('error', err instanceof NetworkError ? '서버 연결 끊김 — 브라우저에만 저장 중' : `불러오기 실패: ${err.message}`);
      return { offline: true };
    }
  }
  status('ok', '저장됨');
  return { offline: false, discarded: notes };
}

export const loadSettings = () => normalizeSettings(read(KEY_SETTINGS));

// 설정 저장. 서버 결과를 돌려준다: { ok } / { ok:false, conflict, current } / { ok:false, error }
export async function saveSettings(s, { force = false } = {}) {
  if (!write(KEY_SETTINGS, s)) return { ok: false, error: new Error('브라우저 저장 실패') };
  meta.pending.settings = true;
  saveMeta('settings');
  if (force) {
    // 다른 곳에서 바뀐 것을 무시하고 덮어쓰기: 서버의 현재 버전을 기준으로 다시 보낸다
    try {
      const cur = await api('GET', '/api/state/settings');
      meta.ver.settings = cur.version;
      saveMeta('settings');
    } catch (err) {
      return { ok: false, error: err };
    }
  }
  return push('settings');
}
export const resetSettings = () => saveSettings(normalizeSettings(null));

export const loadGame = () => read(KEY_GAME);
export const loadHistory = () => read(KEY_HISTORY) ?? [];

// 게임 상태 저장(콘솔에서 누를 때마다). 서버로는 순서대로 보낸다.
export function saveGameState(game, history) {
  const ok = write(KEY_GAME, game) && write(KEY_HISTORY, history);
  meta.pending.game = true;
  saveMeta('game');
  push('game');
  return ok;
}
