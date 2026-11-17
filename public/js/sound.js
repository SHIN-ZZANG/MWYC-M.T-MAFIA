// 효과음. 브라우저 정책상 사용자가 화면을 한 번 누른 뒤부터 소리가 난다.
let ctx = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (err) {
    console.error('[sound] 오디오를 켤 수 없습니다', err);
  }
}

// "띠띠띠"
export function beep(times = 3) {
  unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const s = t0 + i * 0.32;
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.exponentialRampToValueAtTime(0.25, s + 0.01);
    gain.gain.setValueAtTime(0.25, s + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(s);
    osc.stop(s + 0.24);
  }
}
