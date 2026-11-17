// 공용 알림창. window.alert / confirm / prompt 대신 dlg.alert / dlg.confirm 을 쓴다.
(function () {
  let queue = Promise.resolve();          // 창을 하나씩만 띄우기 위한 대기열

  function open({ title, message, buttons, choices = [] }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'dlg-backdrop';

      const box = document.createElement('div');
      box.className = 'dlg-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      if (title) {
        const h = document.createElement('h3');
        h.className = 'dlg-title';
        h.textContent = title;
        box.appendChild(h);
      }

      const p = document.createElement('p');
      p.className = 'dlg-msg';
      p.textContent = message;            // innerHTML 금지 (XSS 방어)
      box.appendChild(p);

      // 선택지 목록(dlg.choice): 제목 + 설명을 한 버튼 안에 세로로 쌓는다
      if (choices.length) {
        const list = document.createElement('div');
        list.className = 'dlg-choices';
        choices.forEach((c) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dlg-choice' + (c.danger ? ' danger' : ' primary');
          const t = document.createElement('span');
          t.className = 'dlg-choice-title';
          t.textContent = c.label;
          btn.appendChild(t);
          if (c.desc) {
            const d = document.createElement('span');
            d.className = 'dlg-choice-desc';
            d.textContent = c.desc;
            btn.appendChild(d);
          }
          btn.addEventListener('click', () => close(c.value));
          list.appendChild(btn);
        });
        box.appendChild(list);
      }

      const btnWrap = document.createElement('div');
      btnWrap.className = 'dlg-btns';
      let primaryBtn = null;

      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dlg-btn' + (b.style ? ' ' + b.style : '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => close(b.value));
        if (b.primary) primaryBtn = btn;
        btnWrap.appendChild(btn);
      });
      box.appendChild(btnWrap);
      backdrop.appendChild(box);

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(buttons.find((b) => b.cancel)?.value ?? false); }
        if (e.key === 'Enter')  { e.preventDefault(); close(buttons.find((b) => b.primary)?.value ?? buttons.find((b) => b.cancel)?.value ?? true); }
      }
      function close(value) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      }

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      (primaryBtn || btnWrap.firstChild).focus();
    });
  }

  function enqueue(opts) {
    const p = queue.then(() => open(opts));
    queue = p.catch(() => {});
    return p;
  }

  window.dlg = {
    // 여러 갈래 중 하나 고르기. options: [{ label, desc?, value, danger? }] — 취소 · Enter · Esc 는 null
    choice(message, title = '선택', options = []) {
      return enqueue({ title, message, choices: options,
        buttons: [{ label: '취소', value: null, cancel: true }] });
    },
    alert(message, title = '알림') {
      return enqueue({ title, message,
        buttons: [{ label: '확인', value: true, primary: true, style: 'primary' }] });
    },
    confirm(message, title = '확인', { danger = false } = {}) {
      return enqueue({ title, message,
        buttons: [
          { label: '취소', value: false, cancel: true },
          { label: '확인', value: true, primary: true, style: danger ? 'danger' : 'primary' },
        ] });
    },
  };
})();
