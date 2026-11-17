// 게임 규칙 엔진. 화면과 무관한 순수 로직만 둔다. 상태(g)를 직접 고친다.
import { ABILITIES, TEAMS } from './defaults.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export function fill(tpl, vars = {}) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ── 조회 도우미 ───────────────────────────────────────────────
export const roleById = (g, id) => g.settings.roles.find((r) => r.id === id);
export const playerById = (g, id) => g.players.find((p) => p.id === id);
export const roleOf = (g, p) => roleById(g, p.roleId);
export const teamOf = (g, p) => roleOf(g, p)?.team ?? 'citizen';
export const alive = (g) => g.players.filter((p) => p.alive);
export const members = (g, roleId) => g.players.filter((p) => p.roleId === roleId);
export const aliveMembers = (g, roleId) => members(g, roleId).filter((p) => p.alive);

export function revealText(g, p, scope) {
  if (scope === 'role') return roleOf(g, p)?.name ?? '?';
  if (scope === 'team') return TEAMS[teamOf(g, p)];
  return '';
}

export function addLog(g, text, kind = 'info') {
  g.log.push({ day: g.day, phase: g.phase, text, kind, at: Date.now() });
}

// ── 게임 생성 · 역할 배정 ─────────────────────────────────────
export function fillRole(settings) {
  return settings.roles.find((r) => r.fill);
}

// 이름 목록으로 인원 구성이 맞는지 검사. 문제 목록(문자열 배열)을 돌려준다.
export function validateSetup(settings, names) {
  const errs = [];
  if (names.length < 3) errs.push('참가자는 3명 이상이어야 합니다.');
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) errs.push(`이름이 겹칩니다: ${[...new Set(dup)].join(', ')}`);
  const fixed = settings.roles.filter((r) => !r.fill).reduce((s, r) => s + r.count, 0);
  const fr = fillRole(settings);
  if (names.length < fixed) errs.push(`역할 인원 합계(${fixed}명)보다 참가자(${names.length}명)가 적습니다.`);
  if (names.length > fixed && !fr) errs.push(`참가자(${names.length}명)가 역할 인원 합계(${fixed}명)보다 많은데, 나머지를 받을 역할이 없습니다. 설정에서 "나머지 인원 자동 배정" 역할을 정하세요.`);
  if (!settings.roles.some((r) => r.team === 'mafia' && (r.fill || r.count > 0))) errs.push('마피아 팀 역할이 한 명도 없습니다.');
  return errs;
}

export function createGame(settings, names) {
  const g = {
    settings: clone(settings),
    players: names.map((name, i) => ({
      id: 'p' + (i + 1), name, roleId: null, alive: true, deathDay: null, deathCause: null, shield: 0,
    })),
    phase: 'assign',
    assignIdx: 0,
    day: 1,
    nightPlan: [],
    nightStep: 0,
    nightActions: {},
    roleState: {},
    announce: [],
    report: [],
    winner: null,
    log: [],
    timer: { running: false, endsAt: null, remainMs: settings.discussionSec * 1000 },
  };
  addLog(g, `새 게임 — 참가자 ${names.length}명`);
  return g;
}

export const assignRoles = (g) => g.settings.roles.filter((r) => !r.fill && r.count > 0);

export function setRoleMembers(g, roleId, playerIds) {
  for (const p of g.players) if (p.roleId === roleId) p.roleId = null;
  for (const id of playerIds) playerById(g, id).roleId = roleId;
}

export function finishAssign(g) {
  const fr = fillRole(g.settings);
  for (const p of g.players) if (!p.roleId && fr) p.roleId = fr.id;
  for (const r of g.settings.roles) {
    g.roleState[r.id] = { usesLeft: r.opts.uses > 0 ? r.opts.uses : null, lastTarget: null };
  }
  for (const p of g.players) {
    const r = roleOf(g, p);
    if (r?.ability === 'shield') p.shield = Math.max(0, Number(r.opts.uses) || 0);
  }
  addLog(g, '역할 배정 완료 — ' + g.settings.roles
    .map((r) => `${r.name}: ${members(g, r.id).map((p) => p.name).join(', ') || '-'}`).join(' / '));
  startDay(g);
}

// ── 낮 ────────────────────────────────────────────────────────
export function startDay(g) {
  g.phase = 'day-talk';
  g.timer = { running: false, endsAt: null, remainMs: g.settings.discussionSec * 1000 };
  g.announce = [fill(g.settings.scripts.dayStart, { day: g.day })];
  addLog(g, `${g.day}일차 낮 시작`);
}

function kill(g, p, cause) {
  p.alive = false;
  p.deathDay = g.day;
  p.deathCause = cause;
}

// 연인 동반 사망. deaths: [{p, cause}] 에 이어 붙인다.
function chainLovers(g, deaths) {
  const S = g.settings;
  let added = true;
  while (added) {
    added = false;
    for (const r of S.roles.filter((x) => x.ability === 'lovers')) {
      const trigger = deaths.some((d) => d.p.roleId === r.id && d.cause !== 'lover' && (
        (d.cause === 'mafia' && r.opts.onMafia)
        || (d.cause === 'execution' && r.opts.onExecution)
        || ((d.cause === 'snipe' || d.cause === 'snipeFail') && r.opts.onSnipe)));
      if (!trigger) continue;
      for (const m of aliveMembers(g, r.id)) {
        if (!deaths.some((d) => d.p === m)) { deaths.push({ p: m, cause: 'lover' }); added = true; }
      }
    }
  }
}

function revealSuffix(g, p, scope) {
  if (scope === 'none') return [];
  return [fill(g.settings.scripts.revealLine, { name: p.name, reveal: revealText(g, p, scope) })];
}

// 낮 투표 결과. playerId 가 null 이면 처형 없음.
export function execute(g, playerId) {
  const S = g.settings;
  const lines = [];
  if (!playerId) {
    lines.push(S.scripts.noExecution);
    addLog(g, '투표 결과: 처형 없음');
  } else {
    const p = playerById(g, playerId);
    const r = roleOf(g, p);
    lines.push(fill(S.scripts.execution, { name: p.name }));
    lines.push(...revealSuffix(g, p, S.revealExecution));
    addLog(g, `처형: ${p.name} (${r.name})`, 'death');

    if (r.ability === 'soloWin') {
      kill(g, p, 'execution');
      g.winner = { type: 'solo', line: fill(S.scripts.winSolo, { name: p.name }), playerId: p.id };
      lines.push(g.winner.line);
      addLog(g, `${p.name} 단독 우승`, 'win');
    } else {
      const deaths = [{ p, cause: 'execution' }];
      chainLovers(g, deaths);
      for (const d of deaths) {
        kill(g, d.p, d.cause);
        if (d.cause === 'lover') {
          lines.push(fill(S.scripts.loverDeath, { name: d.p.name }));
          lines.push(...revealSuffix(g, d.p, S.revealExecution));
          addLog(g, `연인 동반 사망: ${d.p.name}`, 'death');
        }
      }
    }
  }
  g.phase = 'day-result';
  g.announce = lines;
  if (!g.winner) checkWin(g);
  return lines;
}

// ── 밤 ────────────────────────────────────────────────────────
function roleWakes(g, r) {
  const night = ABILITIES[r.ability]?.night;
  if (night === true) return true;
  if (night === 'first') return g.day === 1 && r.opts.meetFirstNight;
  return false;
}

export function startNight(g) {
  const S = g.settings;
  g.phase = 'night';
  g.nightActions = {};
  g.nightStep = 0;
  g.nightPlan = [{ kind: 'intro' }];
  for (const r of S.roles) {
    if (!roleWakes(g, r) || members(g, r.id).length === 0) continue;
    if (!aliveMembers(g, r.id).length && !S.callDeadRoles) continue;
    g.nightPlan.push({ kind: 'role', roleId: r.id });
  }
  g.nightPlan.push({ kind: 'summary' });
  g.announce = [S.scripts.nightStart];
  addLog(g, `${g.day}일차 밤 시작`);
}

// 이번 밤 마담에게 유혹당한 사람(id)
export function seducedId(g) {
  for (const r of g.settings.roles.filter((x) => x.ability === 'seduce')) {
    if (aliveMembers(g, r.id).length && g.nightActions[r.id]) return g.nightActions[r.id];
  }
  return null;
}

// 역할 묶음의 능력이 막혔는지: 살아 있는 구성원 중 한 명이라도 유혹당하면 그 밤 능력 무효
export function isBlocked(g, roleId) {
  const sid = seducedId(g);
  const r = roleById(g, roleId);
  if (!sid || r.ability === 'seduce') return false;
  return aliveMembers(g, roleId).some((p) => p.id === sid);
}

export function usesLeft(g, roleId) {
  return g.roleState[roleId]?.usesLeft; // null = 무제한
}

// 밤 단계에서 고를 수 있는 대상 목록
export function targetOptions(g, roleId) {
  const r = roleById(g, roleId);
  const list = alive(g);
  if (r.ability === 'heal') {
    const last = g.roleState[roleId]?.lastTarget;
    return list.filter((p) => (r.opts.selfTarget || p.roleId !== roleId) && !(r.opts.noRepeat && p.id === last));
  }
  if (r.ability === 'seduce') {
    return list.filter((p) => r.opts.selfTarget || teamOf(g, p) !== 'mafia');
  }
  if (r.ability === 'snipe' || r.ability === 'investigate' || r.ability === 'reveal') {
    return list.filter((p) => p.roleId !== roleId);
  }
  return list;
}

export function resolveNight(g) {
  const S = g.settings;
  const act = g.nightActions;
  const lines = [S.scripts.morning];
  const report = [];
  const deaths = [];
  const byAb = (ab) => S.roles.filter((r) => r.ability === ab && aliveMembers(g, r.id).length);
  const scopeN = S.revealNightDeath;

  const sid = seducedId(g);
  if (sid) report.push(`마담 유혹: ${playerById(g, sid).name}`);

  // 치료
  const healed = new Set();
  for (const r of byAb('heal')) {
    const t = act[r.id];
    g.roleState[r.id].lastTarget = t ?? null;
    if (!t) continue;
    if (isBlocked(g, r.id)) { report.push(`${r.name}: 유혹당해 치료 무효`); continue; }
    healed.add(t);
    report.push(`${r.name} 치료: ${playerById(g, t).name}`);
  }

  // 마피아 공격
  for (const r of byAb('mafiaKill')) {
    const t = act[r.id];
    if (!t) { report.push(`${r.name}: 공격 안 함`); continue; }
    if (isBlocked(g, r.id)) { report.push(`${r.name}: 유혹당해 공격 무효`); continue; }
    const p = playerById(g, t);
    const pr = roleOf(g, p);
    const hasShield = pr.ability === 'shield' && p.shield > 0;
    const isHealed = healed.has(t);
    if (isHealed && (pr.opts.healFirst !== false || !hasShield)) {
      lines.push(fill(S.scripts.nightSaved, { name: p.name }));
      report.push(`${r.name} 공격 → ${p.name}: 의사가 살림`);
    } else if (hasShield) {
      p.shield -= 1;
      lines.push(fill(S.scripts.veteranBlock, { name: p.name }));
      report.push(`${r.name} 공격 → ${p.name}: 방탄으로 막음 (남은 방탄 ${p.shield})`);
    } else {
      deaths.push({ p, cause: 'mafia' });
      report.push(`${r.name} 공격 → ${p.name}: 사망`);
    }
  }

  // 저격
  for (const r of byAb('snipe')) {
    const t = act[r.id];
    if (!t) continue;
    if (isBlocked(g, r.id)) { report.push(`${r.name}: 유혹당해 저격 무효 (횟수 차감 안 함)`); continue; }
    const st = g.roleState[r.id];
    if (st.usesLeft !== null) st.usesLeft = Math.max(0, st.usesLeft - 1);
    const p = playerById(g, t);
    if (teamOf(g, p) === 'mafia') {
      if (r.opts.healable && healed.has(t)) {
        lines.push(fill(S.scripts.snipeSaved, { name: p.name }));
        report.push(`${r.name} 저격 → ${p.name}(마피아): 의사가 살림`);
      } else {
        if (!deaths.some((d) => d.p === p)) deaths.push({ p, cause: 'snipe' });
        report.push(`${r.name} 저격 → ${p.name}(마피아): 사살`);
      }
    } else {
      const shooter = aliveMembers(g, r.id)[0];
      if (!deaths.some((d) => d.p === shooter)) deaths.push({ p: shooter, cause: 'snipeFail' });
      report.push(`${r.name} 저격 → ${p.name}(시민): 오발, ${shooter.name} 사망`);
    }
  }

  chainLovers(g, deaths);

  // 사망 처리와 발표 문장
  const causeTpl = { mafia: 'nightKill', snipe: 'snipeKill', snipeFail: 'snipeFail', lover: 'loverDeath' };
  for (const d of deaths) {
    kill(g, d.p, d.cause);
    lines.push(fill(S.scripts[causeTpl[d.cause]], { name: d.p.name }));
    lines.push(...revealSuffix(g, d.p, scopeN));
    addLog(g, `밤 사망: ${d.p.name} (${roleOf(g, d.p).name}, ${CAUSE_LABEL[d.cause]})`, 'death');
  }

  // 기자 공개 (기자는 밤이 시작될 때 살아 있었어야 한다)
  for (const r of S.roles.filter((x) => x.ability === 'reveal')) {
    const t = act[r.id];
    if (!t) continue;
    const reporterAlive = aliveMembers(g, r.id).length > 0;
    const diedTonight = deaths.some((d) => d.p.roleId === r.id);
    if (!reporterAlive && !(diedTonight && r.opts.announceIfDead)) {
      report.push(`${r.name}: 그날 밤 사망해 공개 안 함`);
      continue;
    }
    if (isBlockedAtNight(g, r.id, sid)) { report.push(`${r.name}: 유혹당해 공개 무효 (횟수 차감 안 함)`); continue; }
    const st = g.roleState[r.id];
    if (st.usesLeft !== null) st.usesLeft = Math.max(0, st.usesLeft - 1);
    const p = playerById(g, t);
    lines.push(fill(S.scripts.reporter, { name: p.name, reveal: revealText(g, p, r.opts.scope) }));
    report.push(`${r.name} 공개: ${p.name}`);
  }

  // 경찰 조사는 진행 중에 바로 보여 줬으므로 기록만
  for (const r of S.roles.filter((x) => x.ability === 'investigate')) {
    const t = act[r.id];
    if (t) report.push(`${r.name} 조사: ${playerById(g, t).name} → ${teamOf(g, playerById(g, t)) === 'mafia' ? '마피아' : '마피아 아님'}${isBlockedAtNight(g, r.id, sid) ? ' (유혹당해 결과 안 알려 줌)' : ''}`);
  }

  if (lines.length === 1) lines.push(S.scripts.nothing);

  report.forEach((t) => addLog(g, t, 'night'));
  g.report = report;
  g.announce = lines;
  g.phase = 'morning';
  checkWin(g);
  return { lines, report };
}

// 유혹 판정을 "밤이 시작될 때 구성원" 기준으로 (밤에 죽은 기자도 유혹 여부를 판정해야 하므로)
function isBlockedAtNight(g, roleId, sid) {
  if (!sid) return false;
  return members(g, roleId).some((p) => p.id === sid);
}

export const CAUSE_LABEL = {
  mafia: '마피아 공격', snipe: '저격', snipeFail: '저격 실패', lover: '연인 동반', execution: '낮 처형',
};

// ── 승리 판정 ─────────────────────────────────────────────────
export function checkWin(g) {
  if (g.winner) return g.winner;
  const S = g.settings;
  const al = alive(g);
  const mafia = al.filter((p) => teamOf(g, p) === 'mafia').length;
  const citizen = al.length - mafia;
  if (mafia === 0) g.winner = { type: 'citizen', line: S.scripts.winCitizen };
  else if (S.mafiaWinRule === 'gt' ? mafia > citizen : mafia >= citizen) g.winner = { type: 'mafia', line: S.scripts.winMafia };
  if (g.winner) {
    g.announce = [...g.announce, g.winner.line];
    addLog(g, g.winner.line, 'win');
  }
  return g.winner;
}

export function endGame(g) {
  g.phase = 'over';
}

export function nextDay(g) {
  g.day += 1;
  startDay(g);
}

// 같은 참가자 · 같은 역할 배정으로 1일차 낮부터 다시. 설정은 이 게임이 시작할 때 것을 그대로 쓴다
export function restartGame(g) {
  const fresh = createGame(g.settings, g.players.map((p) => p.name));
  fresh.players.forEach((p, i) => { p.roleId = g.players[i].roleId; });
  addLog(fresh, '같은 배정으로 처음부터 다시 시작');
  finishAssign(fresh);
  return fresh;
}
