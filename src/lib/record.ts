/**
 * A win-loss record, written the one way.
 *
 * "2-1", and "2-1-1" only once somebody has actually tied — a trailing "-0" on
 * every row in a league that has never drawn is a column of noise, and the one
 * week a tie happens it has to be impossible to miss.
 *
 * Here rather than in a component because three screens had written it out
 * separately and a fourth was about to. They agreed, which is the good case;
 * the bad case is the week they stop agreeing and one board starts calling a
 * tie something else.
 */
export function recordText(wins: number, losses: number, ties = 0): string {
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}
