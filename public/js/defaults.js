// 기본 설정값. 설정 화면에서 바꾼 값은 브라우저(localStorage)에 저장되고, 이 파일은 "기본값 복원" 때만 쓴다.

export const TEAMS = { mafia: '마피아', citizen: '시민' };

// 능력 유형. 역할은 이 중 하나를 고르고, opts 로 세부 규칙을 정한다.
//  night: true = 매일 밤 호출 / 'first' = 첫날 밤만 호출(옵션) / false = 호출 없음
export const ABILITIES = {
  none:        { label: '능력 없음', night: false },
  mafiaKill:   { label: '처치 — 밤에 한 명 공격', night: true },
  seduce:      { label: '유혹 — 지목한 사람의 그날 밤 능력 봉인', night: true },
  heal:        { label: '치료 — 지목한 사람을 마피아 공격에서 살림', night: true },
  investigate: { label: '조사 — 마피아인지 확인', night: true },
  snipe:       { label: '저격 — 마피아면 사살, 시민이면 본인 사망', night: true },
  reveal:      { label: '공개 — 아침에 지목한 사람의 정체 발표', night: true },
  shield:      { label: '방탄 — 마피아 공격을 횟수만큼 막음', night: false },
  lovers:      { label: '연인 — 한 명이 죽으면 같이 죽음', night: 'first' },
  soloWin:     { label: '관종 — 낮 투표로 처형되면 단독 우승', night: false },
};

// 능력별 세부 규칙 기본값과 설정 화면 표시용 정의
export const ABILITY_OPTS = {
  heal: [
    { key: 'selfTarget', type: 'bool', label: '자기 자신(의사)도 살릴 수 있음', def: true },
    { key: 'noRepeat', type: 'bool', label: '같은 사람을 이틀 연속 살릴 수 없음', def: false },
  ],
  seduce: [
    { key: 'selfTarget', type: 'bool', label: '마피아 팀도 유혹 대상으로 고를 수 있음', def: false },
  ],
  snipe: [
    { key: 'uses', type: 'num', label: '사용 횟수 (0 = 무제한)', def: 0 },
    { key: 'healable', type: 'bool', label: '의사가 살린 마피아는 저격으로 죽지 않음', def: false },
  ],
  reveal: [
    { key: 'uses', type: 'num', label: '사용 횟수 (0 = 무제한)', def: 1 },
    { key: 'scope', type: 'select', label: '공개 범위', def: 'role',
      options: { role: '역할까지', team: '마피아/시민만' } },
    { key: 'announceIfDead', type: 'bool', label: '기자가 그날 밤 죽어도 아침에 공개', def: true },
  ],
  shield: [
    { key: 'uses', type: 'num', label: '방어 횟수', def: 1 },
    { key: 'healFirst', type: 'bool', label: '의사가 살린 경우 방탄을 쓰지 않음', def: true },
  ],
  lovers: [
    { key: 'onMafia', type: 'bool', label: '마피아 공격으로 죽으면 같이 죽음', def: true },
    { key: 'onExecution', type: 'bool', label: '낮 투표로 처형되면 같이 죽음', def: false },
    { key: 'meetFirstNight', type: 'bool', label: '첫날 밤에 호출해 서로 확인', def: true },
  ],
};

export function defaultOpts(ability) {
  const o = {};
  for (const d of ABILITY_OPTS[ability] ?? []) o[d.key] = d.def;
  return o;
}

const role = (id, name, team, count, ability, guide, nightScript, extra = {}) => ({
  id, name, team, count, ability, guide, nightScript,
  fill: false, opts: defaultOpts(ability), ...extra,
});

export const DEFAULT_SETTINGS = {
  version: 1,
  discussionSec: 180,          // 낮 회의 타이머
  beep: true,                  // 타이머 종료 효과음
  revealExecution: 'role',     // 낮 처형 시 공개: role | team | none
  revealNightDeath: 'role',    // 밤 사망 시 공개: role | team | none
  callDeadRoles: true,         // 죽은 역할도 밤에 호출(누가 죽었는지 숨김)
  mafiaWinRule: 'gte',         // gte: 마피아 ≥ 시민이면 마피아 승 / gt: 마피아 > 시민
  roster: [],                  // 참가자 명단(이름). 판마다 참여 · 제외는 콘솔에서 고른다
  roles: [
    role('mafia', '마피아', 'mafia', 4, 'mafiaKill',
      '마피아 팀입니다. 밤마다 서로 의논해서 한 명을 공격합니다.\n마담이 누구인지는 서로 압니다.',
      '마피아는 고개를 들어 주세요. 서로 얼굴을 확인하고, 오늘 밤 죽일 사람을 한 명 지목해 주세요.'),
    role('madam', '마담', 'mafia', 1, 'seduce',
      '마피아 팀입니다. 밤마다 한 명을 유혹해서 그 사람의 그날 밤 능력을 막습니다.',
      '마담은 고개를 들어 주세요. 오늘 밤 유혹할 사람을 한 명 지목해 주세요.'),
    role('lovers', '연인', 'citizen', 2, 'lovers',
      '시민 팀입니다. 두 사람은 연인입니다.\n한 명이 마피아에게 죽으면 다른 한 명도 같이 죽습니다.',
      '연인은 고개를 들어 서로 얼굴을 확인해 주세요.'),
    role('doctor', '의사', 'citizen', 2, 'heal',
      '시민 팀입니다. 의사 두 명이 밤마다 의논해서 한 명을 살립니다.',
      '의사는 고개를 들어 주세요. 두 분이 의논해서 오늘 밤 살릴 사람을 한 명 지목해 주세요.'),
    role('police', '경찰', 'citizen', 1, 'investigate',
      '시민 팀입니다. 밤마다 한 명이 마피아인지 확인할 수 있습니다.',
      '경찰은 고개를 들어 주세요. 마피아인지 궁금한 사람을 한 명 지목해 주세요.'),
    role('sniper', '스나이퍼', 'citizen', 1, 'snipe',
      '시민 팀입니다. 밤에 한 명을 저격합니다.\n마피아를 맞히면 그 마피아가 죽고, 시민을 맞히면 본인이 죽습니다.',
      '스나이퍼는 고개를 들어 주세요. 저격할 사람이 있으면 지목하고, 없으면 고개를 저어 주세요.'),
    role('reporter', '기자', 'citizen', 1, 'reveal',
      '시민 팀입니다. 게임 중 한 번, 밤에 지목한 사람의 정체를 다음 날 아침 익명으로 공개합니다.',
      '기자는 고개를 들어 주세요. 정체를 공개할 사람이 있으면 지목하고, 아직 쓰지 않으려면 고개를 저어 주세요.'),
    role('veteran', '퇴역군인(만석이)', 'citizen', 1, 'shield',
      '시민 팀입니다. 방탄유리가 있어서 마피아의 공격을 한 번 막습니다.',
      ''),
    role('attention', '관종', 'citizen', 1, 'soloWin',
      '시민 팀으로 집계되지만, 낮 투표로 처형되면 혼자 우승합니다.',
      ''),
    role('citizen', '시민', 'citizen', 4, 'none',
      '시민 팀입니다. 특별한 능력은 없습니다. 토론으로 마피아를 찾아내세요.',
      '', { fill: true }),
  ],
  // 사회자 멘트 템플릿. {name} {role} {team} {reveal} {day} 를 바꿔 넣는다.
  scripts: {
    dayStart: '{day}일차 낮이 되었습니다. 회의를 시작해 주세요.',
    voteStart: '회의가 끝났습니다. 처형할 사람을 투표로 정해 주세요.',
    execution: '투표 결과, {name} 님이 처형되었습니다.',
    noExecution: '투표 결과, 아무도 처형되지 않았습니다.',
    revealLine: '{name} 님의 정체는 [{reveal}] 입니다.',
    nightStart: '밤이 되었습니다. 모든 플레이어는 고개를 숙여 주세요.',
    nightRoleEnd: '고개를 숙여 주세요.',
    morning: '아침이 밝았습니다. 모두 고개를 들어 주세요.',
    nightKill: '밤사이 {name} 님이 마피아에게 살해당했습니다.',
    nightSaved: '밤사이 {name} 님이 마피아에게 공격당했습니다. 하지만 의사가 살렸습니다!',
    veteranBlock: '밤사이 {name} 님이 마피아에게 공격당했습니다.\n만석씨~?\n"이거 방탄유리야 ㄱㅅㄲ야!"\n방탄유리가 공격을 막아냈습니다.',
    snipeKill: '밤사이 총성이 울렸습니다. {name} 님이 저격당해 사망했습니다.',
    snipeFail: '밤사이 총성이 울렸습니다. {name} 님이 사망했습니다.',
    snipeSaved: '밤사이 총성이 울렸지만, {name} 님은 의사 덕분에 살아남았습니다.',
    loverDeath: '{name} 님은 연인을 잃은 슬픔에 함께 세상을 떠났습니다.',
    reporter: '[속보] 익명의 기자가 지목한 사람은 {name} 님, 정체는 [{reveal}] 입니다.',
    nothing: '밤사이 아무 일도 일어나지 않았습니다.',
    winMafia: '마피아 팀이 승리했습니다!',
    winCitizen: '시민 팀이 승리했습니다!',
    winSolo: '관종 {name} 님이 처형되어 단독 우승했습니다!',
  },
};

export const SCRIPT_LABELS = {
  dayStart: '낮 시작',
  voteStart: '투표 시작',
  execution: '처형',
  noExecution: '처형 없음',
  revealLine: '정체 공개 문장 (처형·사망 뒤에 붙음)',
  nightStart: '밤 시작',
  nightRoleEnd: '역할 호출 끝',
  morning: '아침',
  nightKill: '마피아 공격으로 사망',
  nightSaved: '의사가 살림',
  veteranBlock: '퇴역군인 방어',
  snipeKill: '저격 성공',
  snipeFail: '저격 실패(스나이퍼 사망)',
  snipeSaved: '저격당했지만 의사가 살림',
  loverDeath: '연인 동반 사망',
  reporter: '기자 공개',
  nothing: '아무 일 없음',
  winMafia: '마피아 승리',
  winCitizen: '시민 승리',
  winSolo: '관종 단독 우승',
};

export const REVEAL_LABELS = { role: '역할까지 공개', team: '마피아/시민만 공개', none: '공개 안 함' };
