// 설정 화면. 바꾼 값은 [저장]을 눌러야 브라우저에 저장된다.
// 화면 구성: [참가자 명단] [진행 규칙] [역할] [멘트] 탭 / 역할 탭 안에서는 팀 선택 → 역할 탭 → 역할 하나의 설정
import { ABILITIES, ABILITY_OPTS, TEAMS, SCRIPT_LABELS, REVEAL_LABELS, DEFAULT_SETTINGS, defaultOpts } from '/js/defaults.js';
import { initStore, adoptServer, loadSettings, saveSettings, normalizeSettings, loadGame, splitNames, sortRolesByTeam } from '/js/store.js';
import { esc } from '/js/util.js';

const $form = document.getElementById('form');
const $save = document.getElementById('btn-save');
let S = loadSettings();
let dirty = false;

// 마지막으로 보던 탭 기억
const VIEW_KEY = 'mafia.settingsView';
const view = { section: 'roster', team: 'mafia', roleId: null };
try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}')); } catch { /* 기본값 사용 */ }
const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* 무시 */ } };

const SECTIONS = { roster: '참가자 명단', rules: '진행 규칙', roles: '역할', scripts: '사회자 멘트' };

function setDirty(v) {
  dirty = v;
  $save.classList.toggle('dirty', v);
  $save.textContent = v ? '저장 *' : '저장';
}

const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
const fixedCount = () => S.roles.filter((r) => !r.fill).reduce((s, r) => s + r.count, 0);
const fillCount = () => Math.max(0, S.roster.length - fixedCount());
const roleSize = (r) => (r.fill ? fillCount() : r.count);
const teamRoles = (team) => S.roles.filter((r) => r.team === team);
const teamSize = (team) => teamRoles(team).reduce((s, r) => s + roleSize(r), 0);

// ── 그리기 ────────────────────────────────────────────────────
function render() {
  if (!SECTIONS[view.section]) view.section = 'roster';
  const game = loadGame();
  const tabs = Object.entries(SECTIONS).map(([k, label]) => {
    const extra = k === 'roster' ? `${S.roster.length}명` : k === 'roles' ? `${S.roles.length}개` : '';
    return `<button type="button" class="sec-tab ${view.section === k ? 'on' : ''}" data-act="section" data-k="${k}" role="tab" aria-selected="${view.section === k}">
      ${esc(label)}${extra ? `<small>${extra}</small>` : ''}</button>`;
  }).join('');

  const body = { roster: viewRoster, rules: viewRules, roles: viewRoles, scripts: viewScripts }[view.section]();

  $form.innerHTML = `
  ${game && game.phase !== 'over' ? `<section class="card notice">진행 중인 게임은 시작할 때의 설정으로 계속됩니다. 여기서 바꾼 내용은 다음 새 게임부터 적용됩니다.</section>` : ''}
  <nav class="sec-tabs" role="tablist">${tabs}</nav>
  ${body}`;
  if (view.section === 'roster') renderRoster();
  saveView();
}

function viewRoster() {
  return `
  <section class="card">
    <h2>참가자 명단</h2>
    <p class="desc">이름을 입력하고 Enter 를 누르세요. 단톡방 명단처럼 여러 줄 · 쉼표로 된 글을 붙여 넣으면 한 번에 추가됩니다.<br>판마다 쉬는 사람은 지우지 말고 콘솔 첫 화면에서 "이번 판 제외"로 고르세요.</p>
    <div class="roster-add">
      <input id="roster-input" maxlength="20" placeholder="이름 입력 후 Enter" autocomplete="off">
      <button type="button" class="btn primary" data-act="roster-add">추가</button>
    </div>
    <p id="roster-msg" class="roster-msg"></p>
    <div id="roster-list"></div>
  </section>`;
}

function viewRules() {
  return `
  <section class="card">
    <h2>진행 규칙</h2>
    <p class="desc">타이머, 공개 범위, 승리 조건을 정합니다.</p>
    <div class="grid">
      <label class="field"><span>낮 회의 시간 (초)</span>
        <input type="number" min="10" step="10" data-path="discussionSec" value="${S.discussionSec}"></label>
      <label class="field"><span>낮 처형 시 정체 공개</span>
        <select data-path="revealExecution">${opt(REVEAL_LABELS, S.revealExecution)}</select></label>
      <label class="field"><span>밤 사망 시 정체 공개</span>
        <select data-path="revealNightDeath">${opt(REVEAL_LABELS, S.revealNightDeath)}</select></label>
      <label class="field"><span>마피아 승리 조건</span>
        <select data-path="mafiaWinRule">${opt({ gte: '마피아 수가 시민 수와 같아지면', gt: '마피아 수가 시민 수보다 많아지면' }, S.mafiaWinRule)}</select></label>
    </div>
    <div class="grid mt">
      <label class="check"><input type="checkbox" data-path="beep" ${S.beep ? 'checked' : ''}> 타이머가 끝나면 "띠띠띠" 효과음</label>
      <label class="check"><input type="checkbox" data-path="callDeadRoles" ${S.callDeadRoles ? 'checked' : ''}> 죽은 역할도 밤에 호출 (누가 죽었는지 숨김)</label>
    </div>
  </section>`;
}

function viewScripts() {
  return `
  <section class="card">
    <h2>사회자 멘트</h2>
    <p class="desc hint">바꿔 넣는 자리: <code>{name}</code> 이름 · <code>{reveal}</code> 공개되는 정체 · <code>{day}</code> 일차. 줄바꿈도 그대로 표시됩니다.<br>역할별 밤 호출 멘트는 [역할] 탭에서 정합니다.</p>
    <div class="scripts">
      ${Object.keys(DEFAULT_SETTINGS.scripts).map((k) => `
      <label class="field script-row"><span>${esc(SCRIPT_LABELS[k] ?? k)}</span>
        <textarea data-path="scripts.${k}" rows="${String(S.scripts[k]).split('\n').length}">${esc(S.scripts[k])}</textarea></label>`).join('')}
    </div>
  </section>`;
}

// 역할: 팀 선택 → 역할 탭 → 고른 역할 설정
function viewRoles() {
  if (!TEAMS[view.team]) view.team = 'mafia';
  const roles = teamRoles(view.team);
  let cur = S.roles.find((r) => r.id === view.roleId && r.team === view.team);
  if (!cur) { cur = roles[0] ?? null; view.roleId = cur?.id ?? null; }

  const teamBtns = Object.entries(TEAMS).map(([t, label]) => `
    <button type="button" class="team-btn ${t} ${view.team === t ? 'on' : ''}" data-act="team" data-team="${t}">
      ${esc(label)} 팀 <b>${teamSize(t)}명</b><small>역할 ${teamRoles(t).length}개</small></button>`).join('');

  const roleTabs = roles.map((r) => `
    <button type="button" class="role-tab ${r === cur ? 'on' : ''}" data-act="role" data-id="${esc(r.id)}">
      ${esc(r.name || '(이름 없음)')} <span class="n">${r.fill ? `나머지 ${fillCount()}` : r.count}</span></button>`).join('');

  const fr = S.roles.find((r) => r.fill);
  return `
  <section class="card">
    <div class="team-row">${teamBtns}</div>
    <p class="desc order-desc">역할 배정 · 밤 호출 순서: <b>마피아 팀 → 시민 팀</b>, 팀 안에서는 탭 순서대로입니다.
      고정 인원 ${fixedCount()}명${fr ? ` + ${esc(fr.name)} 나머지 ${fillCount()}명 (명단 ${S.roster.length}명 기준)` : ''}</p>
    <div class="role-tabs ${view.team}" role="tablist">${roleTabs}
      <button type="button" class="role-tab add" data-act="add-role">+ 역할 추가</button>
    </div>
    ${cur ? roleDetail(cur) : `<p class="empty">${esc(TEAMS[view.team])} 팀에 역할이 없습니다. [+ 역할 추가]를 누르세요.</p>`}
  </section>`;
}

function roleDetail(r) {
  const i = S.roles.indexOf(r);
  const p = (k) => `roles.${i}.${k}`;
  const siblings = teamRoles(r.team);
  const pos = siblings.indexOf(r);
  const opts = (ABILITY_OPTS[r.ability] ?? []).map((d) => {
    const v = r.opts[d.key];
    if (d.type === 'bool') return `<label class="check"><input type="checkbox" data-path="${p('opts.' + d.key)}" ${v ? 'checked' : ''}> ${esc(d.label)}</label>`;
    if (d.type === 'num') return `<label class="field"><span>${esc(d.label)}</span><input type="number" min="0" data-path="${p('opts.' + d.key)}" value="${Number(v) || 0}"></label>`;
    return `<label class="field"><span>${esc(d.label)}</span><select data-path="${p('opts.' + d.key)}">${opt(d.options, v)}</select></label>`;
  }).join('');
  const wakes = ABILITIES[r.ability]?.night;

  return `
  <div class="role-detail ${r.team}">
    <div class="role-top">
      <span class="muted small">전체 순서 ${i + 1}번째</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-act="move" data-dir="-1" ${pos === 0 ? 'disabled' : ''} title="앞으로">◀ 앞으로</button>
      <button type="button" class="btn sm" data-act="move" data-dir="1" ${pos === siblings.length - 1 ? 'disabled' : ''} title="뒤로">뒤로 ▶</button>
      <button type="button" class="btn sm" data-act="del">삭제</button>
    </div>
    <div class="grid">
      <label class="field"><span>역할 이름</span><input data-path="${p('name')}" value="${esc(r.name)}" data-rerender></label>
      <label class="field"><span>팀</span><select data-path="${p('team')}" data-rerender>${opt(TEAMS, r.team)}</select></label>
      <label class="field"><span>인원</span>
        <input type="number" min="0" data-path="${p('count')}" value="${r.count}" ${r.fill ? 'disabled' : ''} data-rerender></label>
      <label class="field"><span>능력</span>
        <select data-path="${p('ability')}" data-rerender>${opt(Object.fromEntries(Object.entries(ABILITIES).map(([k, a]) => [k, a.label])), r.ability)}</select></label>
    </div>
    <label class="check mt"><input type="checkbox" data-act="fill" ${r.fill ? 'checked' : ''}> 나머지 인원 자동 배정 — 인원 수를 정하지 않고, 다른 역할을 배정하고 남은 사람이 모두 받음 (전체에서 한 역할만)</label>
    ${opts ? `<div class="opts">${opts}</div>` : ''}
    <div class="grid mt two">
      <label class="field"><span>역할 가이드 (배정할 때 표시)</span><textarea data-path="${p('guide')}" rows="3">${esc(r.guide)}</textarea></label>
      <label class="field"><span>밤 호출 멘트 ${wakes ? (wakes === 'first' ? '(첫날 밤만)' : '') : '<em class="muted">(이 능력은 밤에 호출하지 않음)</em>'}</span>
        <textarea data-path="${p('nightScript')}" rows="3">${esc(r.nightScript)}</textarea></label>
    </div>
  </div>`;
}

// ── 참가자 명단 ───────────────────────────────────────────────
// 명단 영역만 다시 그린다(입력칸 포커스 유지)
function renderRoster() {
  const $list = document.getElementById('roster-list');
  if (!$list) return;
  const n = S.roster.length;
  const fixed = fixedCount();
  const fr = S.roles.find((r) => r.fill);
  let check;
  if (n < fixed) check = `<span class="bad">고정 역할 합계(${fixed}명)보다 ${fixed - n}명 부족합니다.</span>`;
  else if (n > fixed && !fr) check = `<span class="bad">나머지 ${n - fixed}명을 받을 역할이 없습니다. [역할] 탭에서 "나머지 인원 자동 배정"을 고르세요.</span>`;
  else check = `<span class="good">고정 역할 ${fixed}명${fr ? ` + ${esc(fr.name)} ${n - fixed}명` : ''}</span>`;

  $list.innerHTML = `
    <p class="roster-count">명단 <b>${n}</b>명 · ${check}</p>
    <div class="roster">${S.roster.map((name, i) => `
      <span class="tag"><span class="no">${i + 1}</span>${esc(name)}<button type="button" class="x" data-act="roster-del" data-i="${i}" aria-label="${esc(name)} 삭제">×</button></span>`).join('')}
    </div>
    ${n ? '<div class="mt"><button type="button" class="btn sm" data-act="roster-clear">전체 지우기</button></div>' : ''}`;
  const $tab = document.querySelector('.sec-tab[data-k="roster"] small');
  if ($tab) $tab.textContent = `${n}명`;
}

function addNames(list) {
  const added = [];
  const dup = [];
  for (const raw of list) {
    const name = raw.trim().slice(0, 20);
    if (!name) continue;
    if (S.roster.includes(name)) dup.push(name);
    else { S.roster.push(name); added.push(name); }
  }
  const $msg = document.getElementById('roster-msg');
  const parts = [];
  if (added.length) parts.push(`${added.length}명 추가했습니다. [저장]을 눌러야 반영됩니다.`);
  if (dup.length) parts.push(`이미 있는 이름이라 넣지 않았습니다: ${dup.join(', ')}`);
  $msg.textContent = parts.join(' ');
  $msg.className = 'roster-msg' + (dup.length ? ' bad' : '');
  if (added.length) { setDirty(true); renderRoster(); }
}

function addFromInput() {
  const $in = document.getElementById('roster-input');
  const list = splitNames($in.value);
  if (!list.length) return;
  addNames(list);
  $in.value = '';
  $in.focus();
}

$form.addEventListener('keydown', (e) => {
  if (e.target.id === 'roster-input' && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    addFromInput();
  }
});
$form.addEventListener('paste', (e) => {
  if (e.target.id !== 'roster-input') return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/[\n,\t]/.test(text)) return; // 이름 하나면 평소처럼 붙여 넣기
  e.preventDefault();
  addNames(splitNames(text));
});

// ── 입력 반영 ─────────────────────────────────────────────────
// data-path 경로에 값 넣기 ("roles.2.opts.uses")
function setPath(path, value) {
  const keys = path.split('.');
  let o = S;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Math.max(0, Number(el.value) || 0);
  return el.value;
}

$form.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.path) return;
  setPath(el.dataset.path, readInput(el));
  if (el.dataset.path.endsWith('.ability')) {
    const i = Number(el.dataset.path.split('.')[1]);
    S.roles[i].opts = defaultOpts(S.roles[i].ability);
  }
  setDirty(true);
});
$form.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.hasAttribute('data-rerender')) return;
  // 팀을 바꾸면 그 팀의 맨 끝으로 옮기고 화면도 그 팀으로 전환
  if (el.dataset.path?.endsWith('.team')) {
    const r = S.roles[Number(el.dataset.path.split('.')[1])];
    S.roles = sortRolesByTeam([...S.roles.filter((x) => x !== r), r]);
    view.team = r.team;
    view.roleId = r.id;
  }
  render();
});

const currentRole = () => S.roles.find((r) => r.id === view.roleId);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const i = Number(el.dataset.i);
  switch (el.dataset.act) {
    case 'section': view.section = el.dataset.k; render(); window.scrollTo(0, 0); break;
    case 'team': view.team = el.dataset.team; view.roleId = null; render(); break;
    case 'role': view.roleId = el.dataset.id; render(); break;
    case 'add-role': {
      const r = {
        id: 'r' + Date.now().toString(36), name: '새 역할', team: view.team, count: 1, ability: 'none',
        fill: false, guide: '', nightScript: '', opts: {},
      };
      S.roles = sortRolesByTeam([...S.roles, r]);
      view.roleId = r.id;
      setDirty(true); render();
      document.querySelector('[data-path$=".name"]')?.select();
      break;
    }
    case 'move': {
      const r = currentRole();
      const sib = teamRoles(r.team);
      const j = sib.indexOf(r) + Number(el.dataset.dir);
      if (j < 0 || j >= sib.length) break;
      const a = S.roles.indexOf(r);
      const b = S.roles.indexOf(sib[j]);
      [S.roles[a], S.roles[b]] = [S.roles[b], S.roles[a]];
      setDirty(true); render();
      break;
    }
    case 'del': {
      const r = currentRole();
      if (await dlg.confirm(`"${r.name}" 역할을 삭제할까요?`, '역할 삭제', { danger: true })) {
        S.roles = S.roles.filter((x) => x !== r);
        view.roleId = null;
        setDirty(true); render();
      }
      break;
    }
    case 'fill': {
      const r = currentRole();
      const on = el.checked;
      S.roles.forEach((x) => { x.fill = on && x === r; });
      setDirty(true); render();
      break;
    }
    case 'roster-add': addFromInput(); break;
    case 'roster-del':
      S.roster.splice(i, 1);
      document.getElementById('roster-msg').textContent = '';
      setDirty(true); renderRoster();
      break;
    case 'roster-clear':
      if (await dlg.confirm(`참가자 명단 ${S.roster.length}명을 모두 지울까요?`, '명단 지우기', { danger: true })) {
        S.roster = []; setDirty(true); renderRoster();
      }
      break;
    case 'save': await save(); break;
    case 'reset':
      if (await dlg.confirm('모든 설정을 기본값으로 되돌릴까요?\n참가자 명단도 비워집니다.', '기본값 복원', { danger: true })) {
        S = normalizeSettings(null);
        view.roleId = null;
        await save('기본값으로 되돌렸습니다.');
      }
      break;
    case 'back':
      if (dirty) {
        e.preventDefault();
        if (await dlg.confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 나갈까요?', '나가기', { danger: true })) { setDirty(false); location.href = '/'; }
      }
      break;
    default: break;
  }
});

// ── 저장 ─────────────────────────────────────────
function validate() {
  const errs = [];
  if (!S.roles.length) errs.push('역할이 하나도 없습니다.');
  S.roles.forEach((r) => { if (!String(r.name).trim()) errs.push(`${TEAMS[r.team]} 팀에 이름이 비어 있는 역할이 있습니다.`); });
  const names = S.roles.map((r) => r.name.trim());
  const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
  if (dup.length) errs.push(`역할 이름이 겹칩니다: ${[...new Set(dup)].join(', ')}`);
  if (!S.roles.some((r) => r.team === 'mafia')) errs.push('마피아 팀 역할이 하나도 없습니다.');
  if (S.discussionSec < 10) errs.push('낮 회의 시간은 10초 이상이어야 합니다.');
  return errs;
}

async function save(doneMsg = '저장했습니다. 다음 새 게임부터 적용됩니다.') {
  const errs = validate();
  if (errs.length) { await dlg.alert(errs.join('\n'), '저장할 수 없습니다'); return; }
  S = normalizeSettings(S);
  $save.disabled = true;
  let r = await saveSettings(S);
  if (r.conflict) {
    // 다른 창 · PC 에서 먼저 설정을 바꿈
    const overwrite = await dlg.confirm(
      '다른 창이나 PC에서 설정을 먼저 바꿨습니다.\n\n[확인] 지금 화면의 내용으로 덮어쓰기\n[취소] 다른 곳에서 바꾼 설정을 불러오기 (지금 고친 내용은 사라짐)',
      '설정 충돌', { danger: true });
    if (overwrite) {
      r = await saveSettings(S, { force: true });
    } else {
      S = normalizeSettings(r.current?.data);
      adoptServer('settings', r.current); // 브라우저 사본을 서버 내용으로 맞춤
      $save.disabled = false;
      setDirty(false); render();
      return;
    }
  }
  $save.disabled = false;
  if (!r.ok) {
    setDirty(false); render();
    await dlg.alert(`서버에 저장하지 못했습니다. 이 브라우저에는 저장했고, 서버에 다시 연결되면 자동으로 올립니다.\n${r.error?.message ?? ''}`, '서버 저장 실패');
    return;
  }
  setDirty(false);
  render();
  await dlg.alert(doneMsg);
}

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// 시작: 로그인 → 서버 파일에서 설정 불러오기 → 그리기
async function start() {
  $form.innerHTML = '<section class="card"><p class="muted">서버에서 불러오는 중…</p></section>';
  const r = await initStore();
  if (r.offline) await dlg.alert('서버에 연결할 수 없습니다. 이 브라우저에 저장된 설정을 보여 줍니다.', '오프라인');
  S = loadSettings();
  render();
}

start();
