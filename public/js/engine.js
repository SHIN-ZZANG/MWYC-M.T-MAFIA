// 게임 규칙 엔진. 화면과 무관한 순수 로직만 둔다. 상태(g)를 직접 고친다.
import { ABILITIES, TEAMS, DEFAULT_SETTINGS } from './defaults.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
// 진행 중인 게임은 시작할 때의 설정을 쓰므로, 나중에 생긴 멘트는 기본값으로 채운다
const DEFAULT_SCRIPTS = DEFAULT_SETTINGS.scripts;

// 빈 줄로 나눈 문구 중 하나를 무작위로 고른다(한 덩어리 안의 줄바꿈은 그대로)
function pickVariant(text) {
  const list = String(text ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list[Math.floor(Math.random() * list.length)] : '';
}

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
  return TEAMS[teamOf(g, p)];
}

// 경찰 조사 결과: 마담은 마피아 팀이지만 시민으로 나온다
export const looksMafia = (g, p) => teamOf(g, p) === 'mafia' && roleOf(g, p)?.ability !== 'seduce';

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
    players: [...names].sort((a, b) => a.localeCompare(b, 'ko')).map((name, i) => ({
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
  startIntro(g);
}

// ── 첫 확인 (1일차 낮 전) ─────────────────────────────────────
// 마피아(마담 제외)끼리, 연인끼리 서로 얼굴을 확인한다. 의사 · 마담은 부르지 않는다
export const INTRO_ABILITIES = ['mafiaKill', 'lovers'];

export function startIntro(g) {
  g.introPlan = g.settings.roles
    .filter((r) => INTRO_ABILITIES.includes(r.ability) && members(g, r.id).length)
    .map((r) => r.id);
  g.introStep = 0;
  if (!g.introPlan.length) { startDay(g); return; }
  g.phase = 'intro';
  addLog(g, '첫 확인 — ' + g.introPlan.map((id) => roleById(g, id).name).join(', '));
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
// 연인 규칙(고정): 마피아 공격 · 낮 처형으로 죽으면 남은 연인도 따라 죽는다.
// 밤에 따라 죽을 연인을 의사가 살렸으면 살고, saved 에 남긴다(아침에 연인임을 밝힌다)
function chainLovers(g, deaths, healed = new Set(), saved = []) {
  const S = g.settings;
  let added = true;
  while (added) {
    added = false;
    for (const r of S.roles.filter((x) => x.ability === 'lovers')) {
      const first = deaths.find((d) => d.p.roleId === r.id && ['mafia', 'snipe', 'execution'].includes(d.cause));
      if (!first) continue;
      for (const m of aliveMembers(g, r.id)) {
        if (deaths.some((d) => d.p === m) || saved.some((s) => s.p === m)) continue;
        if (healed.has(m.id)) { saved.push({ p: m, lover: first.p }); continue; }
        deaths.push({ p: m, cause: 'lover' }); added = true;
      }
    }
  }
}

// 처형 · 밤 사망 공개는 팀만(고정). 마담도 팀(마피아)으로만 공개한다.
// 마피아 공격으로 죽은 사람은 정체를 밝히지 않는다(마담이 마피아에게 죽어도 드러나지 않게)
function revealSuffix(g, p, cause) {
  if (cause === 'mafia' || cause === 'snipeFail') return []; // 스나이퍼 자결은 멘트로 이미 드러난다
  const S = g.settings.scripts;
  const tpl = teamOf(g, p) === 'mafia'
    ? (S.revealMafia ?? '{name} 님은 마피아였습니다.')
    : (S.revealCitizen ?? '{name} 님은 선량한 시민이었습니다.');
  return [fill(tpl, { name: p.name })];
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
    lines.push(...revealSuffix(g, p, 'execution'));
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
          lines.push(...revealSuffix(g, d.p, d.cause));
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
  if (night === 'first') return g.day === 1;
  return false;
}

export function startNight(g) {
  const S = g.settings;
  g.phase = 'night';
  g.nightActions = {};
  g.nightStep = 0;
  g.nightPlan = [{ kind: 'intro' }];
  // 설정의 역할 순서대로 부른다(기본: 마피아 → 마담 → 의사 → 경찰 → 스나이퍼 → 기자).
  // 밤 행동은 아침에 한꺼번에 처리하므로 부르는 순서는 결과에 영향이 없다
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
    return list; // 의사 자신 · 같은 사람 연속 치료 모두 가능
  }
  if (r.ability === 'seduce') {
    return list.filter((p) => p.roleId !== roleId); // 마담 본인만 빼고 누구나(마피아도 가능)
  }
  if (r.ability === 'snipe' || r.ability === 'investigate' || r.ability === 'reveal') {
    return list.filter((p) => p.roleId !== roleId);
  }
  return list;
}

// 보이지만 고를 수 없는 대상: 마피아는 마피아(같은 역할)를 지목할 수 없다
export function targetDisabled(g, roleId, p) {
  return roleById(g, roleId).ability === 'mafiaKill' && p.roleId === roleId;
}

// 밤 지목을 진행 기록에 실시간으로 남긴다(kind 'pick'). 지목을 바꾸면 줄을 쌓지 않고 다시 쓴다 —
// 이번 밤의 pick 줄을 모두 지우고 호출 순서대로 다시 붙인다(유혹 대상이 바뀌면 다른 역할의 유혹 표시도 바뀌므로).
// 밤 결과를 처리하면 밤 상세 결과가 같은 내용을 남기므로 pick 줄은 지운다.
export function syncPickLog(g) {
  g.log = g.log.filter((l) => l.kind !== 'pick');
  const sid = seducedId(g);
  for (const st of g.nightPlan) {
    if (st.kind !== 'role' || !(st.roleId in g.nightActions)) continue;
    const r = roleById(g, st.roleId);
    const names = aliveMembers(g, r.id).map((p) => p.name);
    const actor = names.length ? `${r.name}(${names.join(', ')})` : r.name;
    const t = g.nightActions[r.id];
    const tp = t ? playerById(g, t) : null;
    const target = tp ? `지목 → ${roleOf(g, tp)?.name ?? '?'}(${tp.name})` : '지목 안 함';
    const blocked = r.ability !== 'seduce' && sid && aliveMembers(g, r.id).some((p) => p.id === sid);
    addLog(g, `🌙 ${actor} ${target}${blocked ? ' (유혹당함 — 무효)' : ''}`, 'pick');
  }
}

export function resolveNight(g) {
  const S = g.settings;
  const act = g.nightActions;
  g.log = g.log.filter((l) => l.kind !== 'pick');
  const lines = [S.scripts.morning];
  const report = [];
  const deaths = [];
  const byAb = (ab) => S.roles.filter((r) => r.ability === ab && aliveMembers(g, r.id).length);

  // 사회자용 기록은 "역할(이름)" 으로 적는다. 행동한 쪽 이름은 밤이 시작될 때 살아 있던 사람 기준
  const startAlive = new Set(g.players.filter((p) => p.alive).map((p) => p.id));
  const who = (p) => `${roleOf(g, p)?.name ?? '?'}(${p.name})`;
  const whoId = (id) => who(playerById(g, id));
  const actor = (r) => {
    const names = members(g, r.id).filter((p) => startAlive.has(p.id)).map((p) => p.name);
    return names.length ? `${r.name}(${names.join(', ')})` : r.name;
  };

  // 유혹당해 능력이 무효가 된 역할의 위트 멘트(빈 줄로 나눈 문구 중 하나)
  const seducedLine = (key) => {
    const line = pickVariant(S.scripts[key] ?? DEFAULT_SCRIPTS[key]);
    if (line) lines.push(line);
  };

  const sid = seducedId(g);
  if (sid) {
    const madam = S.roles.find((r) => r.ability === 'seduce' && act[r.id] === sid);
    report.push(`${madam ? actor(madam) : '마담'} 유혹 → ${whoId(sid)}`);
  }

  // 치료
  const healed = new Set();
  for (const r of byAb('heal')) {
    const t = act[r.id];
    g.roleState[r.id].lastTarget = t ?? null;
    if (isBlocked(g, r.id)) {
      seducedLine('doctorSeduced');
      report.push(t ? `${actor(r)} 치료 → ${whoId(t)}: 유혹당해 무효` : `${actor(r)}: 유혹당함 (치료 안 함)`);
      continue;
    }
    if (!t) continue;
    healed.add(t);
    report.push(`${actor(r)} 치료 → ${whoId(t)}`);
  }

  // 마피아 공격
  for (const r of byAb('mafiaKill')) {
    const t = act[r.id];
    if (isBlocked(g, r.id)) {
      seducedLine('mafiaSeduced');
      report.push(t ? `${actor(r)} 공격 → ${whoId(t)}: 마담에게 유혹당해 무효` : `${actor(r)}: 마담에게 유혹당해 공격 무효`);
      continue;
    }
    if (!t) { report.push(`${actor(r)}: 공격 안 함`); continue; }
    const p = playerById(g, t);
    const pr = roleOf(g, p);
    const hasShield = pr.ability === 'shield' && p.shield > 0;
    const isHealed = healed.has(t);
    if (isHealed) { // 의사가 살렸으면 방탄은 쓰지 않는다
      lines.push(fill(S.scripts.nightSaved, { name: p.name }));
      report.push(`${actor(r)} 공격 → ${who(p)}: 의사가 살림`);
    } else if (hasShield) {
      p.shield -= 1;
      lines.push(fill(S.scripts.veteranBlock, { name: p.name }));
      report.push(`${actor(r)} 공격 → ${who(p)}: 방탄으로 막음 (남은 방탄 ${p.shield})`);
    } else {
      deaths.push({ p, cause: 'mafia' });
      report.push(`${actor(r)} 공격 → ${who(p)}: 사망`);
    }
  }

  // 저격
  const snipeSuicides = [];
  for (const r of byAb('snipe')) {
    const t = act[r.id];
    if (isBlocked(g, r.id)) {
      seducedLine('sniperSeduced');
      report.push(t ? `${actor(r)} 저격 → ${whoId(t)}: 유혹당해 무효 (횟수 차감 안 함)` : `${actor(r)}: 유혹당함 (저격 안 함)`);
      continue;
    }
    if (!t) continue;
    // 행동은 받지만, 같은 밤 마피아에게 죽었으면(치료 · 방탄 없이) 저격은 무효 — 맞은 사람도 안 죽고 기회도 안 쓴다
    const shooters = aliveMembers(g, r.id);
    if (shooters.every((s) => deaths.some((d) => d.p === s && d.cause === 'mafia'))) {
      report.push(`${actor(r)} 저격 → ${whoId(t)}: 마피아에게 당해 무효`);
      continue;
    }
    // 방아쇠를 당겼으면 결과와 상관없이 기회를 쓴다
    const st = g.roleState[r.id];
    if (st.usesLeft !== null) st.usesLeft = Math.max(0, st.usesLeft - 1);
    const p = playerById(g, t);
    const pr = roleOf(g, p);
    if (deaths.some((d) => d.p === p)) {
      // 같은 밤 마피아에게 이미 죽은 사람 — 저격 효과 없음, 스나이퍼도 산다
      report.push(`${actor(r)} 저격 → ${who(p)}: 이미 마피아에게 사망해 효과 없음`);
    } else if (healed.has(t)) {
      // 마피아든 시민이든 같은 문구로 발표한다 — 정체가 드러나지 않게. 의사가 살렸으면 방탄은 쓰지 않는다
      lines.push(fill(S.scripts.snipeSaved ?? DEFAULT_SCRIPTS.snipeSaved, { name: p.name }));
      report.push(`${actor(r)} 저격 → ${who(p)}: 의사가 살림`);
    } else if (pr.ability === 'shield' && p.shield > 0) {
      p.shield -= 1;
      lines.push(fill(S.scripts.snipeBlock ?? DEFAULT_SCRIPTS.snipeBlock, { name: p.name }));
      report.push(`${actor(r)} 저격 → ${who(p)}: 방탄으로 막음 (남은 방탄 ${p.shield})`);
    } else if (teamOf(g, p) === 'mafia') {
      deaths.push({ p, cause: 'snipe' });
      report.push(`${actor(r)} 저격 → ${who(p)}: 사살`);
    } else {
      // 시민을 쏘면 그 시민이 죽고, 스나이퍼도 죄책감에 따라 죽는다(발표는 연인 동반 사망 뒤에)
      deaths.push({ p, cause: 'snipe' });
      const shooter = aliveMembers(g, r.id)[0];
      if (!deaths.some((d) => d.p === shooter)) snipeSuicides.push({ p: shooter, cause: 'snipeFail' });
      report.push(`${actor(r)} 저격 → ${who(p)}: 시민 사망, ${who(shooter)} 자결`);
    }
  }

  const loverSaved = [];
  chainLovers(g, deaths, healed, loverSaved);
  for (const s of snipeSuicides) if (!deaths.some((d) => d.p === s.p)) deaths.push(s);

  // 사망 처리와 발표 문장
  const causeTpl = { mafia: 'nightKill', snipe: 'snipeKill', snipeFail: 'snipeFail', lover: 'loverDeath' };
  for (const d of deaths) {
    kill(g, d.p, d.cause);
    lines.push(fill(S.scripts[causeTpl[d.cause]], { name: d.p.name }));
    lines.push(...revealSuffix(g, d.p, d.cause));
    addLog(g, `밤 사망: ${d.p.name} (${roleOf(g, d.p).name}, ${CAUSE_LABEL[d.cause]})`, 'death');
  }
  for (const s of loverSaved) {
    lines.push(fill(S.scripts.loverSaved, { name: s.p.name, lover: s.lover.name }));
    report.push(`${who(s.p)}: ${who(s.lover)}을(를) 따라 죽으려 했으나 의사가 살림`);
  }

  // 기자 공개 (기자는 밤이 시작될 때 살아 있었어야 한다)
  for (const r of S.roles.filter((x) => x.ability === 'reveal')) {
    const t = act[r.id];
    if (isBlockedAtNight(g, r.id, sid)) {
      seducedLine('reporterSeduced');
      report.push(t ? `${actor(r)} 공개 → ${whoId(t)}: 유혹당해 무효 (횟수 차감 안 함)` : `${actor(r)}: 유혹당함 (공개 안 함)`);
      continue;
    }
    if (!t) continue;
    const reporterAlive = aliveMembers(g, r.id).length > 0;
    const diedTonight = deaths.some((d) => d.p.roleId === r.id);
    if (!reporterAlive && !diedTonight) { // 그날 밤 죽은 기자는 공개된다
      report.push(`${actor(r)} 공개 → ${whoId(t)}: 그날 밤 이전에 사망해 공개 안 함`);
      continue;
    }
    const st = g.roleState[r.id];
    if (st.usesLeft !== null) st.usesLeft = Math.max(0, st.usesLeft - 1);
    const p = playerById(g, t);
    lines.push(fill(S.scripts.reporter, { name: p.name, reveal: revealText(g, p, 'role') }));
    report.push(`${actor(r)} 공개 → ${who(p)}`);
  }

  // 경찰 조사는 진행 중에 바로 보여 줬으므로 기록만
  for (const r of S.roles.filter((x) => x.ability === 'investigate')) {
    const t = act[r.id];
    if (isBlockedAtNight(g, r.id, sid)) {
      seducedLine('policeSeduced');
      if (!t) report.push(`${actor(r)}: 유혹당함 (조사 안 함)`);
    }
    if (t) report.push(`${actor(r)} 조사 → ${whoId(t)}: ${isBlockedAtNight(g, r.id, sid) ? '유혹당해 결과 안 알려 줌' : `${looksMafia(g, playerById(g, t)) ? '마피아로' : '시민으로'} 알려 줌`}`);
  }

  // 죽음 · 치료 · 방탄 · 기자 공개 등 무슨 일이든 있었으면 "사건이 벌어졌습니다"를 먼저 읽는다
  if (lines.length === 1) lines.push(S.scripts.nothing);
  else lines.splice(1, 0, S.scripts.incident ?? '사건이 벌어졌습니다.');

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
