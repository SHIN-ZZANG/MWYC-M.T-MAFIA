// 참가자 화면. 사회자 콘솔이 보내 주는 문장 · 타이머만 보여 준다(역할 정보는 받지 않음, 게임 종료 때만 공개).
import { createLink, formatTime, esc } from '/js/display-link.js';

const $title = document.getElementById('title');
const $timer = document.getElementById('timer');
const $lines = document.getElementById('lines');
const $reveal = document.getElementById('reveal');
let timer = null;
let skew = 0; // 콘솔과 이 창의 시계 차이(같은 PC면 0)

const link = createLink((msg) => {
  if (msg?.kind !== 'state') return;
  skew = msg.now ? Date.now() - msg.now : 0;
  document.body.dataset.theme = msg.theme ?? 'idle';
  $title.textContent = msg.title ?? '';
  $lines.innerHTML = (msg.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join('');
  timer = msg.timer ?? null;
  $timer.hidden = !timer;
  if (msg.reveal) {
    $reveal.hidden = false;
    $reveal.innerHTML = msg.reveal.map((p) => `<tr class="${p.alive ? '' : 'dead'}"><td>${esc(p.name)}</td><td class="${p.team}">${esc(p.role)}</td></tr>`).join('');
  } else {
    $reveal.hidden = true;
  }
  tick();
});

function tick() {
  if (!timer) return;
  const ms = timer.running ? Math.max(0, timer.endsAt + skew - Date.now()) : timer.remainMs;
  $timer.textContent = formatTime(ms);
  $timer.classList.toggle('urgent', ms > 0 && ms <= 10000);
  $timer.classList.toggle('done', ms === 0);
}
setInterval(tick, 200);

link.post({ kind: 'hello' });

document.getElementById('fs').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.().catch((err) => console.error('[display] 전체 화면 실패', err));
});
