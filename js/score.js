// score.js — 순수 채점 함수. DOM·백엔드 접근 없음.

/** 실제 답안만 [teamId, answer] 쌍으로 돌려준다. 제출 수·집계·체크마크는 전부 이 함수로 센다. */
export const realAnswers = doc => Object.entries(doc || {})
  .filter(([k, v]) => /^[\w-]+$/.test(k) && typeof v?.choice === 'number');

// 복수정답 문제(multi)는 고른 번호들을 비트로 묶어 숫자 하나로 저장한다. ①③ → 0b101 = 5
export const toMask = list => list.reduce((m, i) => m | (1 << i), 0);
export const fromMask = m => [...Array(6).keys()].filter(i => m >> i & 1);

/** choice가 i번 보기를 골랐는가. q는 문제 또는 live 둘 다 된다(multi·answer만 본다). */
export const picked = (q, choice, i) => (q.multi ? !!(choice >> i & 1) : choice === i);
export const isAnswer = (q, i) => (q.multi ? q.answer.includes(i) : q.answer === i);
export const isCorrect = (q, choice) => typeof choice === 'number'
  && (q.multi ? choice === toMask(q.answer) : choice === q.answer);

/** 점수에 넣는 문제인가(연습문제·보너스는 scored:false) */
export const scored = q => q.scored !== false && q.answer != null;

/**
 * questions: 채점에 넣을 문제들(호출하는 쪽이 공개된 문제만 골라 넘긴다)
 * answers:   { [qid]: { [teamId]: { choice, ms } } }
 * teams:     [{ id, name }]
 * 정답 수 내림차순, 같으면 맞힌 문제의 응답시간 합이 짧은 순. 동률은 같은 순위.
 */
export function rank(questions, answers, teams, tieBreak = 'speed') {
  const rows = teams.map(t => {
    let correct = 0, ms = 0;
    for (const q of questions.filter(scored)) {
      const a = realAnswers(answers?.[q.id]).find(([k]) => k === String(t.id))?.[1];
      if (a && isCorrect(q, a.choice)) { correct++; ms += Number(a.ms) || 0; }
    }
    return { id: t.id, name: t.name, correct, ms };
  });
  const cmp = (a, b) => b.correct - a.correct || (tieBreak === 'speed' ? a.ms - b.ms : 0);
  rows.sort((a, b) => cmp(a, b) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  rows.forEach((r, i) => { r.rank = i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
