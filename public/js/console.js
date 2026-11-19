// 사회자 콘솔 화면
import * as E from './engine.js';
import { TEAMS, ABILITIES, DEFAULT_SETTINGS } from './defaults.js';
import { initStore, adoptServer, loadSettings, saveSettings, loadGame, loadHistory, saveGameState, splitNames, uniqueNames } from './store.js';
import { beep, unlockAudio } from './sound.js';
import { formatTime, esc } from './util.js';

const $stage = document.getElementById('stage');
const $side = document.getElementById('side');
const $phase = document.getElementById('phase-badge');

let g = null;        // 서버에서 불러온 뒤 채운다(맨 아래 start)
let history = [];
let hideRoles = readPref('mafia.hideRoles') === '1';

function readPref(k) { try { return localStorage.getItem(k); } catch { return null; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } }

// 예전 방식(첫 화면에 이름 직접 입력)으로 저장된 이름이 있으면 설정의 명단으로 옮긴다
async function migrateLastNames() {
  const old = readPref('mafia.lastNames');
  if (old === null) return;
  const S = loadSettings();
  if (!S.roster.length) {
    S.roster = uniqueNames(splitNames(old));
    await saveSettings(S);
  }
  try { localStorage.removeItem('mafia.lastNames'); } catch { /* 무시 */ }
}

// 이번 판에서 제외할 사람(이름). 명단은 설정에서 관리한다
let excluded = new Set((() => { try { return JSON.parse(readPref('mafia.excluded') ?? '[]'); } catch { return []; } })());
const saveExcluded = () => writePref('mafia.excluded', JSON.stringify([...excluded]));
const activeNames = (S) => S.roster.filter((n) => !excluded.has(n));

// ── 상태 변경 · 되돌리기 ─────────────────────────────────────
// 브라우저 사본에 바로 쓰고, 서버 파일로는 순서대로 보낸다(상단 저장 표시 참고)
function persist() {
  if (!saveGameState(g, history)) {
    console.warn('[console] 브라우저 저장 실패 — 서버 저장만 시도합니다.');
  }
}

// 되돌릴 수 있는 변경. 바뀌기 전 상태를 history 에 쌓는다.
function commit(mutate) {
  history.push(JSON.stringify(g));
  if (history.length > 150) history.shift();
  try {
    mutate();
  } catch (err) {
    console.error('[console] 처리 중 오류', err);
    g = JSON.parse(history.pop());
    dlg.alert(`처리 중 오류가 났습니다. 직전 상태로 되돌렸습니다.\n${err.message}`, '오류');
  }
  persist();
  render();
}

// 되돌릴 필요 없는 가벼운 변경(밤 지목 선택, 단계 이동, 타이머)
function touch(mutate) {
  mutate();
  persist();
  render();
}

// ── 타이머 ────────────────────────────────────────────────────
const remain = () => (g.timer.running ? Math.max(0, g.timer.endsAt - Date.now()) : g.timer.remainMs);

function timerStart() {
  if (remain() <= 0) g.timer.remainMs = g.settings.discussionSec * 1000;
  g.timer.endsAt = Date.now() + g.timer.remainMs;
  g.timer.running = true;
}
function timerPause() {
  g.timer.remainMs = remain();
  g.timer.running = false;
  g.timer.endsAt = null;
}
function timerAdd(ms) {
  if (g.timer.running) g.timer.endsAt = Math.max(Date.now(), g.timer.endsAt + ms);
  else g.timer.remainMs = Math.max(0, g.timer.remainMs + ms);
}
function timerReset() {
  g.timer = { running: false, endsAt: null, remainMs: g.settings.discussionSec * 1000 };
}

setInterval(() => {
  if (!g || g.phase !== 'day-talk') return;
  const $t = document.getElementById('timer');
  if ($t) {
    const ms = remain();
    $t.textContent = formatTime(ms);
    $t.classList.toggle('urgent', ms > 0 && ms <= 10000);
    $t.classList.toggle('done', ms === 0);
  }
  if (g.timer.running && remain() <= 0) {
    g.timer.running = false;
    g.timer.remainMs = 0;
    g.timer.endsAt = null;
    if (g.settings.beep) beep(3);
    touch(() => {});
  }
}, 200);

// ── 화면 그리기 ───────────────────────────────────────────────
const teamBadge = (team) => `<span class="badge ${team}">${esc(TEAMS[team])}</span>`;
const lines = (arr) => arr.map((l) => `<p>${esc(l)}</p>`).join('');
// 문구 꼬리표: 능력(규칙 요약, 사회자 참고) · 가이드(역할 받은 사람에게 알려 줄 설명) · 멘트(소리 내어 읽는 문장)
const LBL = { 능력: 'ability', 가이드: 'guide', 멘트: 'script' };
const lbl = (k) => `<span class="lbl lbl-${LBL[k]}">${k}</span>`;
const ment = (arr) => `<div class="lbl-row">${lbl('멘트')}</div>${lines(arr)}`;
const endLine = (text) => `<p class="muted small">${lbl('멘트')} 끝나면: "${esc(text)}"</p>`;

function render() {
  $phase.textContent = phaseLabel();
  $phase.className = 'phase-badge ' + (g ? themeOf() : 'idle');
  document.body.dataset.theme = g ? themeOf() : 'idle';
  document.getElementById('btn-undo').disabled = !g || history.length === 0;
  document.getElementById('btn-restart').disabled = !g;
  document.getElementById('btn-hide').textContent = hideRoles ? '역할 보이기' : '역할 가리기';

  if (!g) $stage.innerHTML = viewSetup();
  else {
    const views = {
      assign: viewAssign, intro: viewIntro, 'day-talk': viewDayTalk, 'day-vote': viewDayVote, 'day-result': viewResult,
      night: viewNight, morning: viewResult, over: viewOver,
    };
    $stage.innerHTML = (views[g.phase] ?? (() => '<p>알 수 없는 단계입니다.</p>'))();
  }
  $side.innerHTML = viewSide();
}

function themeOf() {
  if (g.phase === 'over') return 'over';
  if (g.phase === 'night' || g.phase === 'intro') return 'night';
  if (g.phase === 'assign') return 'idle';
  return 'day';
}

function phaseLabel() {
  if (!g) return '준비';
  return {
    assign: '역할 배정', intro: '첫 확인', 'day-talk': `${g.day}일차 낮 · 회의`, 'day-vote': `${g.day}일차 낮 · 투표`,
    'day-result': `${g.day}일차 낮 · 결과`, night: `${g.day}일차 밤`, morning: `${g.day + 1}일차 아침`, over: '게임 종료',
  }[g.phase] ?? g.phase;
}

// 준비: 설정의 명단에서 이번 판 참여 · 제외 고르기
function viewSetup() {
  const S = loadSettings();
  const names = activeNames(S);
  const errs = names.length ? E.validateSetup(S, names) : [];
  const fixed = S.roles.filter((r) => !r.fill).reduce((s, r) => s + r.count, 0);
  const fr = E.fillRole(S);
  const comp = S.roles.map((r) => {
    const n = r.fill ? Math.max(0, names.length - fixed) : r.count;
    return `<li>${teamBadge(r.team)} <b>${esc(r.name)}</b> ${r.fill ? `<span class="muted">(나머지)</span>` : ''} <span class="cnt">${n}명</span></li>`;
  }).join('');

  return `
  <section class="card">
    <h2>이번 판 참가자 <a class="btn sm ghost" href="/settings/">명단 수정</a></h2>
    ${S.roster.length ? `
    <p class="muted">이번 판에 쉬는 사람은 눌러서 제외하세요. 다시 누르면 참여로 돌아옵니다.</p>
    <div class="roster">${S.roster.map((n, i) => {
      const out = excluded.has(n);
      return `<button type="button" class="tag ${out ? 'out' : 'in'}" data-act="toggle-player" data-name="${esc(n)}" aria-pressed="${!out}">
        <span class="no">${i + 1}</span>${esc(n)}${out ? '<small>제외</small>' : ''}</button>`;
    }).join('')}</div>
    <p class="count-line">참여 <b>${names.length}</b>명${excluded.size ? ` (제외 ${S.roster.length - names.length}명 <button type="button" class="btn sm ghost" data-act="all-in">모두 참여</button>)` : ''} · 고정 역할 합계 ${fixed}명${fr ? ` · ${esc(fr.name)} ${Math.max(0, names.length - fixed)}명(자동)` : ''}</p>
    ${errs.length ? `<ul class="errs">${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`
    : `<p class="empty">참가자 명단이 비어 있습니다. <a href="/settings/">설정</a>에서 명단을 먼저 등록하세요.</p>`}
  </section>
  <section class="card">
    <h2>역할 구성 <a class="btn sm ghost" href="/settings/">설정에서 바꾸기</a></h2>
    <ul class="comp">${comp}</ul>
    <p class="muted small">낮 회의 ${formatTime(S.discussionSec * 1000)} · 처형 · 밤 사망 공개: 마피아/시민만</p>
  </section>
  <div class="actions">
    <button type="button" class="btn primary big" data-act="start-assign" ${!names.length || errs.length ? 'disabled' : ''}>역할 배정 시작</button>
  </div>`;
}

// 역할 배정: 역할 하나씩 가이드를 보여 주고 사람을 고른다
function viewAssign() {
  const roles = E.assignRoles(g);
  if (g.assignIdx >= roles.length) return viewAssignSummary();
  const r = roles[g.assignIdx];
  const picked = E.members(g, r.id);
  const full = picked.length >= r.count;
  const chips = g.players.map((p) => {
    const mine = p.roleId === r.id;
    const other = p.roleId && !mine ? E.roleById(g, p.roleId) : null;
    const disabled = other || (!mine && full);
    return `<button type="button" class="chip ${mine ? 'on' : ''} ${other ? 'taken' : ''}" data-act="assign-toggle" data-id="${p.id}" ${disabled ? 'disabled' : ''}>
      ${esc(p.name)}${other ? `<small>${esc(other.name)}</small>` : ''}</button>`;
  }).join('');

  return `
  <section class="card role-card ${r.team}">
    <div class="step-head">
      <span class="muted">역할 배정 ${g.assignIdx + 1} / ${roles.length}</span>
      ${teamBadge(r.team)}
    </div>
    <h2 class="role-title">${esc(r.name)} <span class="cnt">${picked.length} / ${r.count}명</span></h2>
    <p class="ability muted">${lbl('능력')}${esc(ABILITIES[r.ability]?.label ?? '')}</p>
    ${r.guide ? `<div class="guide"><div class="lbl-row">${lbl('가이드')}</div>${lines(String(r.guide).split('\n'))}</div>` : ''}
  </section>
  <section class="card">
    <h3>[${esc(r.name)}] 역할을 받을 사람을 ${r.count}명 고르세요</h3>
    <div class="chips">${chips}</div>
  </section>
  <div class="actions">
    ${g.assignIdx === 0 ? '' : `<button type="button" class="btn" data-act="assign-prev">◀ ${esc(E.assignRoles(g)[g.assignIdx - 1].name)}</button>`}
    <button type="button" class="btn primary big" data-act="assign-next" ${full ? '' : 'disabled'}>다음</button>
  </div>`;
}

function viewAssignSummary() {
  const fr = E.fillRole(g.settings);
  const rest = g.players.filter((p) => !p.roleId);
  const rows = E.assignRoles(g).map((r) => `<tr><td>${teamBadge(r.team)} ${esc(r.name)}</td><td>${E.members(g, r.id).map((p) => esc(p.name)).join(', ')}</td></tr>`).join('');
  return `
  <section class="card">
    <h2>역할 배정 확인</h2>
    <table class="tbl">${rows}
      ${fr ? `<tr><td>${teamBadge(fr.team)} ${esc(fr.name)} <span class="muted">(나머지)</span></td><td>${rest.map((p) => esc(p.name)).join(', ') || '-'}</td></tr>` : ''}
    </table>
  </section>
  <div class="actions">
    <button type="button" class="btn" data-act="assign-prev">◀ ${esc(E.assignRoles(g).at(-1)?.name ?? '이전')}</button>
    <button type="button" class="btn primary big" data-act="assign-finish">첫 확인 시작</button>
  </div>`;
}

// 첫 확인(1일차 낮 전): 마피아(마담 제외)끼리, 연인끼리 서로 얼굴 확인
function viewIntro() {
  const plan = g.introPlan ?? [];
  const S = g.settings.scripts;
  const D = DEFAULT_SETTINGS.scripts;
  const i = g.introStep ?? 0;
  const head = `<div class="step-head"><span class="muted">첫 확인 ${i + 1} / ${plan.length + 1}</span></div>`;
  const prev = i === 0 ? '' : `<button type="button" class="btn" data-act="intro-prev">◀ ${i === 1 ? '첫 확인 시작' : esc(E.roleById(g, plan[i - 2]).name)}</button>`;
  if (i === 0) {
    return `
    <section class="card announce night">${head}${ment([S.introStart ?? D.introStart])}
      <p class="muted small">부를 역할: ${plan.map((id) => esc(E.roleById(g, id).name)).join(', ')}</p></section>
    <div class="actions"><button type="button" class="btn primary big" data-act="intro-next">역할 호출 시작</button></div>`;
  }
  const r = E.roleById(g, plan[i - 1]);
  const last = i === plan.length;
  return `
  <section class="card announce night role-card ${r.team}">
    ${head}
    <div class="role-line">${teamBadge(r.team)} <b>${esc(r.name)}</b>
      <span class="muted">— ${E.members(g, r.id).map((p) => esc(p.name)).join(', ')}</span></div>
    ${ment([E.fill(S.introCheck ?? D.introCheck, { role: r.name })])}
    ${endLine(S.nightRoleEnd)}
  </section>
  <div class="actions">
    ${prev}
    ${last
      ? '<button type="button" class="btn primary big" data-act="intro-finish">1일차 낮 시작</button>'
      : '<button type="button" class="btn primary big" data-act="intro-next">다음 역할</button>'}
  </div>`;
}

// 낮 회의 + 타이머
// 1일차 낮 회의에서만: 역할 배정이 끝났다는 카드
function assignDoneCard() {
  if (g.day !== 1) return '';
  const n = (team) => g.players.filter((p) => E.teamOf(g, p) === team).length;
  return `<section class="card done-card"><b>✅ 역할 배정이 완료되었습니다</b>
    <span>${esc(TEAMS.mafia)} 팀 ${n('mafia')}명 · ${esc(TEAMS.citizen)} 팀 ${n('citizen')}명</span></section>`;
}

function viewDayTalk() {
  const ms = remain();
  return `
  ${assignDoneCard()}
  <section class="card announce day">${ment(g.announce)}</section>
  <section class="card timer-card">
    <div id="timer" class="timer ${ms === 0 ? 'done' : ''}">${formatTime(ms)}</div>
    <div class="timer-btns">
      <button type="button" class="btn big ${g.timer.running ? '' : 'primary'}" data-act="timer-toggle">${g.timer.running ? '일시정지' : (ms === g.settings.discussionSec * 1000 ? '회의 시작' : '계속')}</button>
      <button type="button" class="btn" data-act="timer-add" data-ms="-30000">−30초</button>
      <button type="button" class="btn" data-act="timer-add" data-ms="30000">+30초</button>
      <button type="button" class="btn" data-act="timer-reset">타이머 초기화</button>
    </div>
  </section>
  <div class="actions">
    <button type="button" class="btn primary big" data-act="to-vote">투표로 넘어가기</button>
  </div>`;
}

// 낮 투표: 처형된 사람 선택
function viewDayVote() {
  const btns = E.alive(g).map((p) => `<button type="button" class="chip" data-act="execute" data-id="${p.id}">${esc(p.name)}${roleTag(p)}</button>`).join('');
  return `
  <section class="card announce day">${ment([g.settings.scripts.voteStart])}</section>
  <section class="card">
    <h3>투표로 지목된 사람을 고르세요</h3>
    <div class="chips">${btns}</div>
  </section>
  <div class="actions">
    <button type="button" class="btn" data-act="back-talk">회의로 돌아가기</button>
    <button type="button" class="btn" data-act="execute" data-id="">처형 없음 (동점 · 무효)</button>
  </div>`;
}

// 처형 결과 · 아침 발표
function viewResult() {
  const isMorning = g.phase === 'morning';
  const next = g.winner
    ? `<button type="button" class="btn primary big" data-act="to-over">게임 결과 보기</button>`
    : isMorning
      ? `<button type="button" class="btn primary big" data-act="to-day">${g.day + 1}일차 낮 시작</button>`
      : `<button type="button" class="btn primary big" data-act="to-night">밤으로</button>`;
  return `
  <section class="card announce ${g.winner ? 'over' : 'day'}">
    ${ment(g.announce)}
  </section>
  ${isMorning && g.report?.length ? `
  <details class="card host-only" ${hideRoles ? '' : 'open'}>
    <summary>사회자 전용 — 밤 상세 결과</summary>
    <ul>${g.report.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </details>` : ''}
  <div class="actions">${next}</div>`;
}

// 유혹당한 사람에게 보여 줄 전체 화면 안내 — 아무 데나 누르거나 Esc 로 닫는다
function showSeduceNotice() {
  const text = g.settings.scripts.seducedNotice ?? DEFAULT_SETTINGS.scripts.seducedNotice;
  const wrap = document.createElement('div');
  wrap.className = 'seduce-notice';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  for (const line of String(text).split('\n')) {
    const p = document.createElement('p');
    p.textContent = line; // 멘트는 설정에서 온 글이라 textContent 로만 넣는다
    wrap.appendChild(p);
  }
  const hint = document.createElement('small');
  hint.textContent = '화면을 누르면 닫힙니다';
  wrap.appendChild(hint);
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
  wrap.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
}

// 밤 역할 카드에 붙는 능력 한 줄 설명 — 규칙은 고정, 횟수만 설정에서 온다
function abilityDesc(r) {
  const n = Number(r.opts?.uses);
  const uses = n > 0 ? `${n}회` : '횟수 무제한';
  const extra = {
    heal: ['의사 자신도 가능'],
    mafiaKill: ['마피아끼리는 지목 불가', '마담을 모름'],
    seduce: ['본인 빼고 누구나', '마피아를 고르면 그날 마피아 공격 무효', '경찰 조사에는 시민'],
    snipe: [uses, '의사가 살린 마피아는 안 죽음'],
    reveal: ['역할까지 공개', '그날 밤 죽은 사람도 공개', uses],
  }[r.ability] ?? [];
  const label = r.ability === 'seduce' ? '유혹 — 지목한 사람의 그날 밤 능력 봉인' : ABILITIES[r.ability]?.label;
  return [label, ...extra].filter(Boolean).join(' · ');
}

// 밤 진행
const nightStepName = (st) => (st?.kind === 'role' ? `${E.roleById(g, st.roleId).name} 차례` : '밤 시작');

function viewNight() {
  const step = g.nightPlan[g.nightStep];
  const total = g.nightPlan.length;
  const nav = (nextLabel, nextAct = 'night-next') => `
  <div class="actions">
    ${g.nightStep === 0 ? '' : `<button type="button" class="btn" data-act="night-prev">◀ ${esc(nightStepName(g.nightPlan[g.nightStep - 1]))}</button>`}
    <button type="button" class="btn primary big" data-act="${nextAct}">${nextLabel}</button>
  </div>`;
  const head = `<div class="step-head"><span class="muted">밤 진행 ${g.nightStep + 1} / ${total}</span></div>`;

  if (step.kind === 'intro') {
    return `<section class="card announce night">${head}${ment([g.settings.scripts.nightStart])}</section>${nav('역할 호출 시작')}`;
  }
  if (step.kind === 'summary') return viewNightSummary(head, nav);

  const r = E.roleById(g, step.roleId);
  const all = E.members(g, r.id);
  const live = all.filter((p) => p.alive);
  const dead = live.length === 0;
  const left = E.usesLeft(g, r.id);
  const exhausted = left === 0;
  const blocked = E.isBlocked(g, r.id);
  // 유혹당한 역할은 능력이 무효라 지목을 받지 않는다
  const noInput = dead || exhausted || blocked || r.ability === 'lovers';
  const chosen = g.nightActions[r.id] ?? null;

  const notes = [];
  if (dead) notes.push(`<div class="note warn">이 역할은 모두 죽었습니다. 다른 역할처럼 멘트를 읽고 잠시 기다린 뒤 넘어가세요.</div>`);
  if (exhausted) notes.push(`<div class="note warn">능력을 이미 다 썼습니다. 호출만 하고 넘어가세요.</div>`);
  if (blocked && !dead) notes.push(`<div class="note mafia seduced"><span>마담에게 유혹당했습니다. 이번 밤 능력은 무효입니다. 고개를 든 사람에게 안내 화면을 보여 주세요.</span>
    <button type="button" class="btn danger" data-act="seduce-notice">📢 본인에게 안내 화면 보여 주기</button></div>`);
  if (r.ability === 'investigate' && !noInput && !blocked) notes.push(`<div class="note">경찰이 지목한 사람을 고르면 아래에 결과가 뜹니다. 경찰에게만 엄지로 조용히 알려 주세요 — 👍 마피아 / 👎 시민(마담도 시민으로 나옴). 결과는 아침 발표에 나오지 않습니다.</div>`);
  if (left !== null && left !== undefined && !exhausted) notes.push(`<div class="note">남은 사용 횟수: ${left}회</div>`);

  let body = '';
  if (!noInput) {
    const opts = E.targetOptions(g, r.id);
    const chips = opts.map((p) => {
      const off = E.targetDisabled(g, r.id, p);
      return `<button type="button" class="chip ${chosen === p.id ? 'on' : ''}" data-act="night-pick" data-id="${p.id}" ${off ? 'disabled' : ''}>${esc(p.name)}${roleTag(p)}</button>`;
    }).join('');
    body = `
    <section class="card">
      <h3>지목한 사람을 고르세요</h3>
      <div class="chips">${chips}
        <button type="button" class="chip pass ${chosen === null ? 'on' : ''}" data-act="night-pick" data-id="">선택 안 함</button>
      </div>
      ${r.ability === 'investigate' && chosen ? investigateResult(chosen, blocked) : ''}
    </section>`;
  }

  return `
  <section class="card announce night role-card ${r.team}">
    ${head}
    <div class="role-line">${teamBadge(r.team)} <b>${esc(r.name)}</b>
      <span class="muted">— ${all.map((p) => `${esc(p.name)}${p.alive ? '' : '(사망)'}`).join(', ')}</span></div>
    <p class="role-desc">${lbl('능력')}${esc(abilityDesc(r))}</p>
    ${ment([r.nightScript || `${r.name}은(는) 고개를 들어 주세요.`])}
    ${endLine(g.settings.scripts.nightRoleEnd)}
  </section>
  ${notes.join('')}
  ${body}
  ${nav(g.nightStep + 1 === total - 1 ? '호출 끝 — 결과 확인' : '다음 역할')}`;
}

function investigateResult(targetId, blocked) {
  const p = E.playerById(g, targetId);
  if (blocked) return `<div class="verdict blocked">유혹당함 — 결과를 알려 주지 마세요<br><small>위의 [안내 화면 보여 주기]로 유혹당한 것을 알려 주세요</small></div>`;
  const isMafia = E.looksMafia(g, p);
  return `<div class="verdict ${isMafia ? 'mafia' : 'citizen'}">${esc(p.name)} 님은 ${isMafia ? '마피아입니다 👍' : '시민입니다 👎'}</div>`;
}

function viewNightSummary(head, nav) {
  const rows = g.nightPlan.filter((s) => s.kind === 'role').map((s) => {
    const r = E.roleById(g, s.roleId);
    if (r.ability === 'lovers') return '';
    const t = g.nightActions[r.id];
    const dead = !E.aliveMembers(g, r.id).length;
    return `<tr><td>${teamBadge(r.team)} ${esc(r.name)}</td><td>${dead ? '<span class="muted">사망</span>' : t ? esc(E.playerById(g, t).name) : '<span class="muted">선택 안 함</span>'}${E.isBlocked(g, r.id) ? ' <span class="badge mafia">유혹당함</span>' : ''}</td></tr>`;
  }).join('');
  return `
  <section class="card">
    ${head}
    <h2>밤 행동 확인</h2>
    <p class="muted">고친 것이 있으면 아래 [◀ 역할 차례] 버튼으로 돌아가세요. 확인을 누르면 결과가 처리됩니다.</p>
    <table class="tbl">${rows}</table>
  </section>
  ${nav('밤 결과 처리 → 아침 발표', 'night-resolve')}`;
}

function viewOver() {
  const rows = g.players.map((p) => {
    const r = E.roleOf(g, p);
    return `<tr class="${p.alive ? '' : 'dead'}"><td>${esc(p.name)}</td><td>${teamBadge(r.team)} ${esc(r.name)}</td><td>${p.alive ? '생존' : `${p.deathDay}일차 ${esc(E.CAUSE_LABEL[p.deathCause] ?? '')}`}</td></tr>`;
  }).join('');
  return `
  <section class="card announce over">${ment([g.winner?.line ?? '게임이 끝났습니다.'])}</section>
  <section class="card"><h2>전체 역할 공개</h2><table class="tbl">${rows}</table></section>
  <div class="actions">
    <button type="button" class="btn primary big" data-act="replay">같은 멤버로 새 게임</button>
  </div>`;
}

function roleTag(p) {
  if (hideRoles) return '';
  const r = E.roleOf(g, p);
  return r ? `<small class="${r.team}">${esc(r.name)}</small>` : '';
}

// 오른쪽: 참가자 현황 + 진행 기록
function viewSide() {
  if (!g) {
    return `<section class="card"><h3>사용 방법</h3><ol class="howto">
      <li>[설정]에서 참가자 명단 · 역할 · 멘트 · 타이머를 정합니다.</li>
      <li>이번 판에 쉬는 사람을 제외하고 역할을 배정합니다.</li>
      <li>사회자만 보는 화면입니다. 참가자에게 화면이 보이지 않게 하세요. 잠깐 보여 줘야 하면 [역할 가리기]를 누르세요.</li>
      <li>확정한 것을 취소하려면 [↶ 이전 단계], 같은 배정으로 다시 하려면 [처음부터]를 누르세요.</li></ol></section>`;
  }
  const sid = g.phase === 'night' ? E.seducedId(g) : null;
  const al = E.alive(g);
  const mafia = al.filter((p) => E.teamOf(g, p) === 'mafia').length;
  const plist = g.players.map((p, i) => {
    const r = E.roleOf(g, p);
    const tags = [];
    if (!p.alive) tags.push(`<span class="badge muted">${p.deathDay}일 ${esc(E.CAUSE_LABEL[p.deathCause] ?? '사망')}</span>`);
    if (!hideRoles && r?.ability === 'shield' && p.alive) tags.push(`<span class="badge warn">방탄 ${p.shield}</span>`);
    if (!hideRoles && sid === p.id) tags.push('<span class="badge mafia">유혹</span>');
    return `<li class="${p.alive ? '' : 'dead'}"><span class="no">${i + 1}</span><span class="nm">${esc(p.name)}</span>
      ${!hideRoles && r ? `<span class="rl ${r.team}">${esc(r.name)}</span>` : ''}${tags.join('')}</li>`;
  }).join('');
  const logs = [...g.log].reverse().slice(0, 80).map((l) => `<li class="${l.kind}"><span class="muted">${l.day}일</span> ${esc(l.text)}</li>`).join('');
  return `
  <section class="card">
    <h3>참가자 <span class="muted small">생존 ${al.length}명${hideRoles ? '' : ` · 마피아 ${mafia} / 시민 ${al.length - mafia}`}</span></h3>
    <ul class="plist">${plist}</ul>
  </section>
  <section class="card"><h3>진행 기록</h3><ul class="log">${logs}</ul></section>`;
}

// ── 이벤트 ────────────────────────────────────────────────────
document.addEventListener('pointerdown', unlockAudio, { once: true });

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const id = el.dataset.id || null;

  switch (el.dataset.act) {
    case 'seduce-notice': showSeduceNotice(); break;
    case 'toggle-roles':
      hideRoles = !hideRoles;
      writePref('mafia.hideRoles', hideRoles ? '1' : '0');
      render();
      break;
    case 'undo':
      if (history.length) { g = JSON.parse(history.pop()); persist(); render(); }
      break;
    case 'restart': {
      if (!g) break;
      const inAssign = g.phase === 'assign';
      const opts = [];
      if (!inAssign) opts.push({ label: '같은 역할로 첫 확인부터', desc: '배정은 그대로 두고 생존 · 능력 횟수 · 진행 기록만 처음으로 (첫 확인 → 1일차 낮)', value: 'day1' });
      opts.push({ label: '역할 다시 배정', desc: '같은 참가자로 배정부터 새로 (지금 저장된 설정 사용)', value: 'reassign', danger: true });
      const pick = await dlg.choice('어디서부터 다시 할까요? 잘못 골라도 [↶ 이전 단계]로 돌아올 수 있습니다.', '처음부터', opts);
      if (pick === 'day1') {
        history.push(JSON.stringify(g));
        if (history.length > 150) history.shift();
        g = E.restartGame(g);
        persist(); render();
      } else if (pick === 'reassign') {
        const S = loadSettings();
        const names = g.players.map((p) => p.name);
        const errs = E.validateSetup(S, names);
        if (errs.length) { await dlg.alert(errs.join('\n'), '역할을 다시 배정할 수 없습니다'); break; }
        history.push(JSON.stringify(g));
        if (history.length > 150) history.shift();
        g = E.createGame(S, names);
        persist(); render();
      }
      break;
    }
    case 'new-game':
      if (!g) break;
      if (await dlg.confirm('진행 중인 게임을 끝내고 처음 화면으로 갈까요?\n지금 게임 기록은 사라집니다.', '새 게임', { danger: true })) {
        g = null; history = []; persist(); render();
      }
      break;
    case 'replay': // 참여 · 제외 선택은 그대로 두고 첫 화면으로
      g = null; history = []; persist(); render();
      break;
    case 'toggle-player': {
      const name = el.dataset.name;
      if (excluded.has(name)) excluded.delete(name); else excluded.add(name);
      saveExcluded(); render();
      break;
    }
    case 'all-in': excluded.clear(); saveExcluded(); render(); break;

    case 'start-assign': {
      const S = loadSettings();
      const names = activeNames(S);
      const errs = E.validateSetup(S, names);
      if (errs.length) { await dlg.alert(errs.join('\n'), '확인 필요'); break; }
      g = E.createGame(S, names);
      history = [];
      persist();
      render();
      break;
    }
    case 'assign-toggle': {
      const r = E.assignRoles(g)[g.assignIdx];
      const p = E.playerById(g, id);
      touch(() => { p.roleId = p.roleId === r.id ? null : (E.members(g, r.id).length < r.count ? r.id : p.roleId); });
      break;
    }
    case 'assign-prev': touch(() => { g.assignIdx = Math.max(0, g.assignIdx - 1); }); break;
    case 'assign-next': touch(() => { g.assignIdx += 1; }); break;
    case 'assign-finish': commit(() => E.finishAssign(g)); break;
    case 'intro-prev': touch(() => { g.introStep = Math.max(0, (g.introStep ?? 0) - 1); }); break;
    case 'intro-next': touch(() => { g.introStep = Math.min(g.introPlan.length, (g.introStep ?? 0) + 1); }); break;
    case 'intro-finish': commit(() => E.startDay(g)); break;

    case 'timer-toggle': touch(() => (g.timer.running ? timerPause() : timerStart())); break;
    case 'timer-add': touch(() => timerAdd(Number(el.dataset.ms))); break;
    case 'timer-reset': touch(timerReset); break;
    case 'to-vote':
      if (g.timer.running && !(await dlg.confirm('타이머가 아직 돌고 있습니다. 투표로 넘어갈까요?', '투표'))) break;
      commit(() => { timerPause(); g.phase = 'day-vote'; });
      break;
    case 'back-talk': commit(() => { g.phase = 'day-talk'; }); break;
    case 'execute': {
      const p = id ? E.playerById(g, id) : null;
      const msg = p ? `${p.name} 님을 처형할까요?` : '이번 투표는 처형 없이 넘어갈까요?';
      if (await dlg.confirm(msg, '투표 결과', { danger: !!p })) commit(() => E.execute(g, id));
      break;
    }
    case 'to-night': commit(() => E.startNight(g)); break;
    case 'night-prev': touch(() => { g.nightStep = Math.max(0, g.nightStep - 1); }); break;
    case 'night-next': touch(() => { g.nightStep = Math.min(g.nightPlan.length - 1, g.nightStep + 1); }); break;
    case 'night-pick': {
      const step = g.nightPlan[g.nightStep];
      if (E.isBlocked(g, step.roleId)) break;
      if (id && E.targetDisabled(g, step.roleId, E.playerById(g, id))) break;
      touch(() => {
        g.nightActions[step.roleId] = id;
        // 유혹 대상이 바뀌면 새로 유혹당한 역할의 이전 지목은 지운다(무효 상태에서 남은 값이 되살아나지 않게)
        if (E.roleById(g, step.roleId).ability === 'seduce') {
          for (const r of g.settings.roles) if (E.isBlocked(g, r.id)) delete g.nightActions[r.id];
        }
      });
      break;
    }
    case 'night-resolve': commit(() => E.resolveNight(g)); break;
    case 'to-day': commit(() => E.nextDay(g)); break;
    case 'to-over': commit(() => E.endGame(g)); break;
    default: break;
  }
});

// ── 시작: 로그인 → 서버 파일에서 상태 불러오기 → 그리기 ───────────
async function start() {
  $stage.innerHTML = '<section class="card"><p class="muted">서버에서 불러오는 중…</p></section>';
  const r = await initStore({
    // 다른 창 · PC 에서 먼저 진행했으면 그쪽 상태로 맞춘다
    async onConflict(doc, current) {
      if (doc !== 'game') return;
      await dlg.alert('다른 창이나 PC에서 게임을 먼저 진행했습니다.\n그쪽의 최신 상태로 다시 불러옵니다.', '동시 진행 감지');
      adoptServer('game', current);
      g = loadGame();
      history = loadHistory();
      render();
    },
  });
  if (r.offline) {
    await dlg.alert('서버에 연결할 수 없습니다.\n이 브라우저에 저장된 내용으로 진행하고, 연결되면 자동으로 서버에 올립니다.', '오프라인');
  } else if (r.discarded?.length) {
    await dlg.alert(`연결이 끊긴 동안 이 브라우저에서 바꾼 ${r.discarded.join(', ')} 내용은, 그 사이 다른 곳에서 먼저 저장해서 서버 내용으로 바꿨습니다.`, '알림');
  }
  await migrateLastNames();
  g = loadGame();
  history = loadHistory();
  render();
}

start();
