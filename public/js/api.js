// 서버 API 호출 + 사회자 로그인 창
const TOKEN_KEY = 'mafia.token';

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
}

export class NetworkError extends Error {}
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function raw(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    throw new NetworkError(`서버에 연결할 수 없습니다. (${err.message})`);
  }
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const e = new ApiError(res.status, data);
    e.reqId = res.headers.get('X-Request-Id');
    throw e;
  }
  return data;
}

// 401 이면 로그인 창을 띄우고 한 번 더 시도
export async function api(method, path, body) {
  try {
    return await raw(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && path !== '/api/login') {
      setToken(null);
      await login();
      return raw(method, path, body);
    }
    throw err;
  }
}

export async function ensureLogin() {
  if (getToken()) {
    try {
      await raw('GET', '/api/session');
      return;
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      setToken(null);
    }
  }
  await login();
}

export function logout() {
  setToken(null);
}

// 비밀번호 입력 창. 맞을 때까지 닫히지 않는다.
let loginPromise = null;
function login() {
  loginPromise ??= new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dlg-backdrop';
    backdrop.innerHTML = `
      <form class="dlg-box" role="dialog" aria-modal="true" autocomplete="off">
        <h3 class="dlg-title">사회자 로그인</h3>
        <p class="dlg-msg">사회자 비밀번호를 입력하세요.</p>
        <input type="password" class="login-input" aria-label="비밀번호" required>
        <p class="login-err" aria-live="polite"></p>
        <div class="dlg-btns"><button type="submit" class="dlg-btn primary">확인</button></div>
      </form>`;
    const form = backdrop.querySelector('form');
    const input = backdrop.querySelector('input');
    const err = backdrop.querySelector('.login-err');
    const btn = backdrop.querySelector('button');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = '';
      try {
        const r = await raw('POST', '/api/login', { password: input.value });
        setToken(r.token);
        backdrop.remove();
        loginPromise = null;
        resolve();
      } catch (ex) {
        err.textContent = ex.message;
        input.select();
      } finally {
        btn.disabled = false;
      }
    });
    document.body.appendChild(backdrop);
    input.focus();
  });
  return loginPromise;
}
