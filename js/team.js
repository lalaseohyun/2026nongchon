// team.js — 참가자 화면
import { EVENT } from './config.js';
import { configured, safeWrite, watch, onConnection, onQueueChange, clearQueue } from './db.js';
import { teamList, getSavedTeam, saveTeam, clearTeam, claimTeam, setPin, checkPin } from './join.js';
import { h, batcher, paragraphs, MARKS } from './dom.js';
import { picked, isCorrect, fromMask } from './score.js';

const app = document.getElementById('app');
const TEAMS = teamList();
const SEEN_KEY = 'lq:seen';
const emptyJoin = () => ({ teamId: null, pin: '', error: '', busy: false });

const S = {
  team: getSavedTeam(),     // { id, pin, resetAt }
  live: undefined,          // undefined = 아직 못 받음
  resetAt: undefined,
  teams: null,
  myAnswer: null,
  pick: null,
  sending: false,
  pending: null,            // 큐에 들어가 재전송을 기다리는 답 { qid, choice }
  editing: null,            // 답을 고치는 중인 문제 id. 마감 전까지는 다시 눌러 덮어쓴다
  queue: 0,
  online: true,
  notice: '',
  join: emptyJoin()
};

const teamOf = id => TEAMS.find(t => t.id === id);
const draw = batcher(render);

// ── 이 기기가 문제를 처음 본 시각 ─────────────────────────

function seenAt(qid) {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY));
    if (s?.qid === qid) return s.t;
  } catch { /* 새로 잰다 */ }
  const t = Date.now();
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ qid, t })); } catch { /* 무시 */ }
  return t;
}
const forgetSeen = () => { try { localStorage.removeItem(SEEN_KEY); } catch { /* 무시 */ } };

// ── 구독 ──────────────────────────────────────────────────

let answerKey = null, stopAnswer = null;
let pinKey = null, stopPin = null;

// 팀·문제가 바뀔 때마다 "내 답"과 "내 PIN" 구독을 갈아 끼운다.
function syncWatches() {
  const aKey = S.team && S.live?.phase === 'quiz' ? `quiz/answers/${S.live.id}/${S.team.id}` : null;
  if (aKey !== answerKey) {
    stopAnswer?.();
    answerKey = aKey;
    S.myAnswer = null;
    stopAnswer = aKey && watch(aKey, v => {
      S.myAnswer = typeof v?.choice === 'number' ? v : null;
      if (S.myAnswer) S.pending = null;
      draw();
    });
  }
  const pKey = S.team?.pin ? `pins/${S.team.id}/${S.team.pin}` : null;
  if (pKey !== pinKey) {
    stopPin?.();
    pinKey = pKey;
    // 진행자가 PIN을 초기화하면 이 값이 사라진다.
    stopPin = pKey && watch(pKey, v => {
      if (v === null) leave(`${EVENT.teamLabel} PIN이 초기화되었습니다. 다시 입장해 주세요.`);
    });
  }
}

function leave(notice = '') {
  clearTeam();
  clearQueue();
  forgetSeen();
  Object.assign(S, { team: null, pick: null, pending: null, editing: null, myAnswer: null, notice, join: emptyJoin() });
  syncWatches();
  draw();
}

function start() {
  watch('quiz/live', v => {
    const prev = S.live;
    S.live = v || { phase: 'lobby' };
    if (S.live.phase === 'quiz') {
      if (S.live.id !== prev?.id) { S.pick = null; S.pending = null; S.editing = null; }
      if (S.live.open) seenAt(S.live.id);
      // 보기가 없다 = 아직 안 열렸거나 문제 리셋됨. 시간 기록과 고른 답을 버린다.
      if (!S.live.choices) { forgetSeen(); S.pick = null; S.pending = null; S.editing = null; }
    }
    syncWatches();
    draw();
  });
  watch('session/resetAt', v => {
    S.resetAt = v ?? null;
    if (S.team && (S.team.resetAt ?? null) !== S.resetAt) leave('퀴즈가 초기화되었습니다. 다시 입장해 주세요.');
    draw();
  });
  watch('teams', v => { S.teams = v; draw(); });
  onConnection(c => { S.online = c; draw(); });
  onQueueChange(n => { S.queue = n; draw(); });
  syncWatches();
}

// ── 동작 ──────────────────────────────────────────────────

function enter(team, pin = null) {
  S.team = { id: team.id, pin, resetAt: S.resetAt };
  saveTeam(S.team);
  S.join = emptyJoin();
  S.notice = '';
  syncWatches();
  draw();
}

async function pickTeam(team) {
  S.notice = '';
  if (EVENT.joinMode !== 'pin') {
    claimTeam(team);
    enter(team);
    return;
  }
  S.join = { ...emptyJoin(), teamId: team.id };
  draw();
}

async function submitPin() {
  const team = teamOf(S.join.teamId);
  const pin = S.join.pin;
  if (!/^\d{4}$/.test(pin)) { S.join.error = '숫자 4자리를 입력해 주세요.'; draw(); return; }
  S.join.busy = true; S.join.error = ''; draw();

  // 이미 PIN이 있는 조면 대조, 없으면 내가 정한다.
  let res = S.teams?.[team.id] ? await checkPin(team, pin) : await setPin(team, pin);
  if (!res.ok && res.reason === 'taken') res = await checkPin(team, pin);

  S.join.busy = false;
  if (res.ok) { enter(team, pin); return; }
  S.join.error = res.reason === 'network'
    ? '연결이 불안정합니다. 잠시 후 다시 눌러 주세요.'
    : `PIN이 맞지 않습니다. 같은 ${EVENT.teamLabel} 분께 확인해 주세요.`;
  draw();
}

async function submitAnswer() {
  const { id, open } = S.live;
  if (!open || S.pick === null || S.sending) return;
  const choice = S.pick;
  S.sending = true; S.notice = ''; draw();
  const now = Date.now();
  const res = await safeWrite(
    `quiz/answers/${id}/${S.team.id}`,
    { choice, ms: now - seenAt(id), at: now },
    { queue: true }
  );
  S.sending = false;
  if (res.ok) { S.myAnswer = { choice }; S.editing = null; }
  else if (res.queued) S.pending = { qid: id, choice };
  else S.notice = '제출하지 못했습니다. 다시 눌러 주세요.';
  draw();
}

// ── 화면 (마크업은 부안 청년포럼의 css/team.css · quiz.css 클래스를 따른다) ──

const bar = document.getElementById('bar');
const foot = document.getElementById('foot');
// 고른 답을 글자로. O/X는 O·X, 복수정답은 ①②③처럼 이어 붙인다.
const mark = (L, i) => (L.ox ? L.choices[i] : MARKS[i]);
const numLabel = (L, c) => (L.multi ? fromMask(c).map(i => MARKS[i]).join('')
  : L.ox ? L.choices[c] : `${MARKS[c]}번`);

// 받침 따라 을/를, 이/가 (존을 · 조를)
const josa = (w, [a, b]) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 > 0 ? a : b);

const center = (...kids) => h('div', { class: 'center' }, ...kids);
const badges = L => h('div', { class: 'badges' },
  h('span', { class: 'badge num' }, L.label), L.type && h('span', { class: 'badge' }, L.type));
const waitbox = (title, sub, slim) => h('div', { class: `waitbox ${slim ? 'slim' : ''}` },
  h('div', { class: 'pulse' }), h('div', { class: 'wt' }, title), h('div', { class: 'ws' }, sub));

function viewJoin() {
  if (S.join.teamId) return viewPin();
  return [
    h('div', { class: 'h' }, `우리 ${josa(EVENT.teamLabel, '을를')} 골라주세요`),
    h('div', { class: 'sub' }, EVENT.joinMode === 'pin'
      ? `${EVENT.teamLabel}마다 숫자 4자리 PIN을 함께 씁니다`
      : `${josa(EVENT.teamLabel, '을를')} 누르면 바로 입장합니다`),
    h('div', { class: 'grid' }, TEAMS.map(t =>
      h('button', { class: `tcard ${S.teams?.[t.id] ? 'taken' : ''}`, onclick: () => pickTeam(t) },
        h('div', { class: 'n' }, t.name),
        t.members.length > 0 && h('div', { class: 'a' }, t.members.join(' · ')))))
  ];
}

function viewPin() {
  const team = teamOf(S.join.teamId);
  const isNew = !S.teams?.[team.id];
  return [center(
    h('div', { class: 'sub' }, isNew ? `${EVENT.teamLabel} PIN 정하기` : `${EVENT.teamLabel} PIN 입력`),
    h('div', { class: 'big team' }, team.name),
    team.members.length > 0 && h('div', { class: 'sub' }, team.members.join(' · ')),
    h('div', { class: 'sub' }, isNew
      ? `${josa(team.name, '이가')} 맞나요? 지금 정하는 숫자 4자리를 같은 ${EVENT.teamLabel} 분들께 알려주세요`
      : `${team.name}에서 정한 숫자 4자리를 입력해주세요`),
    h('input', {
      id: 'pin', class: 'pin', type: 'tel', inputMode: 'numeric', maxLength: 4,
      autocomplete: 'off', placeholder: '0000', value: S.join.pin, disabled: S.join.busy,
      oninput: e => { S.join.pin = e.target.value.replace(/\D/g, '').slice(0, 4); e.target.value = S.join.pin; },
      onkeydown: e => { if (e.key === 'Enter') submitPin(); }
    }),
    S.join.error && h('div', { class: 'err' }, S.join.error),
    h('button', { class: 'primary', disabled: S.join.busy, onclick: submitPin }, S.join.busy ? '확인 중…' : '입장'),
    h('button', { class: 'link', disabled: S.join.busy, onclick: () => { S.join = emptyJoin(); draw(); } },
      `다른 ${EVENT.teamLabel} 고르기`)
  )];
}

function viewQuiz() {
  const L = S.live;
  const mine = S.myAnswer?.choice ?? (S.pending?.qid === L.id ? S.pending.choice : null);

  if (L.revealed) {
    const ok = isCorrect(L, mine);
    const right = L.multi ? L.answer.map(i => MARKS[i]).join('')
      : L.ox ? L.choices[L.answer] : `${MARKS[L.answer]} ${L.choices[L.answer]}`;
    return [
      badges(L),
      h('div', { class: `verdict ${mine === null ? '' : ok ? 'ok' : 'no'}` },
        h('div', { class: 'mk' }, mine === null ? '–' : ok ? 'O' : 'X'),
        h('div', { class: 'lb' }, mine === null ? '답을 제출하지 않았어요' : ok ? '정답입니다!' : '아쉬워요'),
        h('div', { class: 'an' }, `정답 · ${right}`),
        !L.scored && h('div', { class: 'an' }, '점수에는 반영되지 않는 문제예요')),
      L.explanation && h('div', { class: 'card' },
        h('div', { class: 'lb' }, '해설'), paragraphs(L.explanation),
        L.source && h('div', { class: 'src' }, `출처 · ${L.source}`))
    ];
  }

  if (!L.choices) {
    return [center(h('div', { class: 'pulse' }),
      h('div', { class: 'big' }, L.label), h('div', { class: 'sub' }, '곧 시작합니다 · 화면을 봐주세요'))];
  }

  if (mine !== null && S.editing !== L.id) {
    return [badges(L), S.myAnswer
      ? waitbox(`✓ ${numLabel(L, mine)} 제출 완료`, ['잠시만 기다려주세요', h('br'), '곧 정답을 공개합니다'])
      : waitbox(`${numLabel(L, mine)} 재전송 중…`, ['연결이 돌아오면 자동으로 다시 보냅니다', h('br'), '화면을 닫지 마세요']),
    L.open && S.myAnswer && h('button', {
      class: 'edit', onclick: () => { S.editing = L.id; S.pick = mine; draw(); }
    }, '답 수정하기')];
  }

  if (!L.open) return [badges(L), waitbox('답안이 마감되었어요', '곧 정답을 공개합니다')];

  // 한 개 고르는 문제는 누르는 즉시 제출한다. 복수정답만 다 고른 뒤 제출 버튼을 누른다.
  const tap = i => {
    if (L.multi) { S.pick = (S.pick ^ 1 << i) || null; draw(); return; }
    S.pick = i;
    submitAnswer();
  };
  return [
    badges(L),
    S.editing === L.id && h('div', { class: 'notice' }, '다시 고를 답을 눌러주세요'),
    h('div', { class: 'opts' }, L.choices.map((c, i) =>
      h('button', {
        class: `opt ${S.pick !== null && picked(L, S.pick, i) ? 'sel' : ''}`, disabled: S.sending,
        onclick: () => tap(i)
      }, h('span', { class: 'n' }, mark(L, i))))),
    L.multi && h('button', { class: 'primary submit', disabled: S.pick === null || S.sending, onclick: submitAnswer },
      S.sending ? '제출 중…' : S.pick === null ? '해당하는 번호를 모두 골라주세요' : `${numLabel(L, S.pick)} 제출`),
    !L.multi && S.sending && h('div', { class: 'status ok' }, '제출 중…'),
    S.editing === L.id && h('button', {
      class: 'edit', disabled: S.sending, onclick: () => { S.editing = null; S.pick = null; draw(); }
    }, '수정 취소'),
    h('div', { class: 'status' }, L.multi
      ? '해당하는 번호를 모두 누른 뒤 제출해주세요 · 마감 전까지 수정할 수 있어요'
      : '번호를 누르면 바로 제출됩니다 · 마감 전까지 수정할 수 있어요')
  ];
}

function viewFinal() {
  const mr = S.live.ranking && Object.values(S.live.ranking).find(r => String(r.id) === String(S.team.id));
  if (!mr) return [center(h('div', { class: 'big' }, '퀴즈가 끝났습니다'), h('div', { class: 'sub' }, '참여해주셔서 감사합니다'))];
  return [center(
    h('div', { class: 'medal' }, ['🥇', '🥈', '🥉'][mr.rank - 1] || '🎉'),
    h('div', { class: 'sub' }, `${mr.name} 최종`),
    h('div', { class: 'rankbig' }, `${mr.rank}위`),
    h('div', { class: 'big' }, `${mr.correct}문제 정답`))];
}

function viewMain() {
  if (S.live.phase === 'quiz') return viewQuiz();
  if (S.live.phase === 'final') return viewFinal();
  return [center(
    h('div', { class: 'pulse' }),
    h('div', { class: 'big team' }, teamOf(S.team.id)?.name),
    h('div', { class: 'sub' }, '입장했습니다 · 곧 시작합니다'))];
}

let lastSig = '';
function render() {
  // 입력 중인 PIN은 다시 그릴 이유가 아니다.
  const sig = JSON.stringify({ ...S, join: { ...S.join, pin: '' } });
  if (sig === lastSig) return;
  lastSig = sig;

  document.body.classList.toggle('offline', !S.online);
  bar.replaceChildren(
    h('span', { class: `dot ${S.online ? 'live' : ''}` }),
    h('span', { class: 't' }, EVENT.title),
    h('span', { class: 'sp' }),
    S.team && h('span', { class: 'myteam' }, teamOf(S.team.id)?.name) || '');

  if (!configured) { app.replaceChildren(center(h('div', { class: 'err' }, '설정이 비어 있습니다 (js/config.js)'))); return; }
  if (S.live === undefined || S.resetAt === undefined) {
    app.replaceChildren(center(h('div', { class: 'pulse' }), h('div', { class: 'sub' }, '불러오는 중')));
    return;
  }

  const body = S.team ? viewMain() : viewJoin();
  app.replaceChildren(...[S.notice && h('div', { class: 'notice' }, S.notice), ...body].filter(Boolean));
  foot.replaceChildren(...[
    S.team && h('button', { class: 'link', onclick: () => leave() }, `${EVENT.teamLabel} 변경`),
    S.queue > 0 && h('span', { class: 'warn' }, `재전송 대기 ${S.queue}`)
  ].filter(Boolean));
  document.getElementById('pin')?.focus();
}

if (configured) start();
draw();
