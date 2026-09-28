/** Fixed spaced-retrieval ladder from the product spec. Swap for FSRS when > 500 active items. */
export const LADDER = [1, 3, 7, 14, 30, 60] as const

export function nextRung(rung: number, correct: boolean) {
  if (!correct) return 0
  return Math.min(rung + 1, LADDER.length - 1)
}

/** Practice score is an exponential moving average so recent attempts dominate. */
export function updatePracticeScore(prev: number | null, score: number, alpha = 0.3) {
  return prev == null ? score : Math.round((alpha * score + (1 - alpha) * prev) * 10) / 10
}
