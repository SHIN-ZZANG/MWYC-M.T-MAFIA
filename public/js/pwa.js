// 홈 화면 앱(PWA). 서비스 워커를 등록하고, 브라우저로 접속했을 때 맨 위에 설치 안내 띠를 띄운다.
// 띠를 띄우지 않는 경우: 앱으로 열었을 때, 이 기기에서 앱으로 연 적이 있거나 설치했을 때,
// 브라우저가 "이미 설치됨"이라고 알려 줄 때(Chrome 계열), [닫기]를 누르고 30일이 안 지났을 때.
// 아이폰은 Safari 와 홈 화면 앱의 저장 공간이 달라 설치 여부를 알 수 없다 — [닫기] 기억으로만 숨긴다.
(function () {
  const KEY_INSTALLED = 'pwa.installed';
  const KEY_DISMISSED = 'pwa.dismissedUntil';
  const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장이 막혀 있으면 이번만 숨긴다 */ } };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.error('[pwa] 서비스 워커 등록 실패', err));
    });
  }

  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
  if (standalone) { set(KEY_INSTALLED, '1'); return; }
  if (get(KEY_INSTALLED) === '1') return;
  if (Number(get(KEY_DISMISSED)) > Date.now()) return;

  const ua = navigator.userAgent;
  const isKakao = /KAKAOTALK/i.test(ua);
  const isInApp = isKakao || /NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);

  let deferred = null; // beforeinstallprompt 이벤트 (Chrome · Edge · 삼성 인터넷)

  const band = document.createElement('div');
  band.className = 'pwa-band';
  band.setAttribute('role', 'region');
  band.setAttribute('aria-label', '앱 설치 안내');

  const icon = document.createElement('img');
  icon.className = 'pwa-icon';
  icon.src = '/icons/mwyc-192.png';
  icon.alt = '';

  const text = document.createElement('div');
  text.className = 'pwa-text';
  const title = document.createElement('strong');
  title.textContent = '미완예찬 M.T(마피아게임) 앱으로 쓰기';
  const desc = document.createElement('span');
  text.append(title, desc);

  const btns = document.createElement('div');
  btns.className = 'pwa-btns';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '닫기';
  close.addEventListener('click', () => { set(KEY_DISMISSED, String(Date.now() + DISMISS_MS)); hide(); });

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'primary';
  action.hidden = true;

  btns.append(close, action);
  band.append(icon, text, btns);

  // 위로 올려 보낸 뒤 지운다. 움직임 줄이기 설정이면 transitionend 가 안 오므로 시간으로도 지운다.
  function hide() {
    band.classList.remove('on');
    setTimeout(() => band.remove(), 400);
  }

  function render() {
    action.hidden = true;
    action.onclick = null;

    if (isInApp) {
      desc.textContent = isIOS
        ? '이 화면에서는 설치가 안 됩니다. 오른쪽 아래 메뉴에서 "Safari로 열기" 후 공유 → "홈 화면에 추가"를 누르세요.'
        : '이 화면에서는 설치가 안 됩니다. 메뉴(⋮)에서 "다른 브라우저로 열기" 후 Chrome에서 설치하세요.';
      if (isKakao) {
        action.textContent = '브라우저로 열기';
        action.hidden = false;
        action.onclick = () => {
          location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
        };
      }
      return;
    }

    if (deferred) {
      desc.textContent = '홈 화면에 설치하면 주소창 없이 앱처럼 바로 열 수 있습니다.';
      action.textContent = '설치';
      action.hidden = false;
      action.onclick = async () => {
        const ev = deferred;
        deferred = null;
        ev.prompt();
        try {
          const { outcome } = await ev.userChoice;
          if (outcome === 'accepted') hide();
          else render();
        } catch (err) {
          console.error('[pwa] 설치 창 오류', err);
          render();
        }
      };
      return;
    }

    if (isIOS) {
      desc.textContent = '아래(또는 위) 공유 버튼 □↑ 을 누르고 "홈 화면에 추가"를 고르세요.';
      return;
    }

    desc.textContent = '브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 고르세요.';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저 기본 미니 안내 대신 띠의 [설치] 버튼으로 띄운다
    deferred = e;
    render();
  });
  window.addEventListener('appinstalled', () => { set(KEY_INSTALLED, '1'); hide(); });

  function show() {
    render();
    document.body.prepend(band);
    // 붙인 직후에 on 을 주면 옮겨 가는 모습 없이 그 자리에 나타난다 — 한 프레임 쉬고 준다.
    requestAnimationFrame(() => requestAnimationFrame(() => band.classList.add('on')));
  }

  // Chrome 계열은 이 앱이 설치돼 있는지 물어볼 수 있다(manifest 의 related_applications)
  if (navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps()
      .then((apps) => { if (apps.length) set(KEY_INSTALLED, '1'); else show(); })
      .catch((err) => { console.error('[pwa] 설치 여부 확인 실패', err); show(); });
  } else {
    show();
  }
})();
