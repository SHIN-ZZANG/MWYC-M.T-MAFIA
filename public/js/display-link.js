// 사회자 콘솔 ↔ 참가자 화면 연결 (같은 브라우저의 다른 창/탭끼리, 인터넷 불필요)
const CHANNEL = 'mafia-display';

export function createLink(onMessage) {
  let ch = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => onMessage?.(e.data);
  } catch (err) {
    console.error('[display-link] BroadcastChannel 을 쓸 수 없습니다', err);
  }
  return { post: (msg) => { try { ch?.postMessage(msg); } catch (err) { console.error('[display-link] 전송 실패', err); } } };
}

export function formatTime(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
