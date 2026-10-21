// derive.js — state → live 파생 함수. 참가자에게 무엇이 나가는지는 여기서만 정한다.

export const INITIAL_STATE = { phase: 'lobby', index: 0, open: false, revealed: false, asked: [] };

// RTDB는 빈 배열을 저장하지 않으므로 asked가 빠져 돌아올 수 있다.
export const normalizeState = s => ({
  ...INITIAL_STATE, ...(s || {}), asked: Object.values(s?.asked || [])
});

/**
 * 보기는 한 번이라도 답안을 연 문제(asked)에만 넣는다.
 * answer·explanation은 revealed일 때만 넣는다. 그 전에는 필드 자체가 없다.
 */
export function deriveLive(state, questions, { ranking } = {}) {
  const s = normalizeState(state);
  if (s.phase === 'final') return ranking ? { phase: 'final', ranking } : { phase: 'final' };

  const q = questions[s.index];
  if (s.phase !== 'quiz' || !q) return { phase: 'lobby' };

  const live = {
    phase: 'quiz', id: q.id, no: q.no, total: questions.length,
    question: q.question, open: !!s.open, revealed: !!s.revealed,
    label: q.label, type: q.type, ox: !!q.ox, multi: !!q.multi, scored: q.scored !== false
  };
  if (s.asked.includes(q.id) || s.revealed) live.choices = q.choices;
  if (s.revealed) {
    live.answer = q.answer;
    live.explanation = q.explanation;
    if (q.source) live.source = q.source;
  }
  return live;
}
