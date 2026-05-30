// Pure calculation helpers — no Notion, no Telegram, fully unit-testable.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Back-solve the stored opening balance from the balance the user typed RIGHT NOW.
 *
 * The user enters their real current balance. We subtract the net effect of the
 * transactions already in the cycle (`deltaNow`) so that the Live Balance formula
 * `storedInit + delta` reproduces exactly what they typed — no double counting,
 * no matter how many times /setup is re-run.
 *
 * @param {number} typedCurrentBalance - the real balance the user typed during /setup
 * @param {number} deltaNow - net transaction effect on this account so far (income/transfer-in positive, expense/transfer-out negative)
 * @returns {number} the opening balance to store
 */
export function backSolveInit(typedCurrentBalance, deltaNow) {
  return typedCurrentBalance - deltaNow;
}

/**
 * Inclusive day count between two YYYY-MM-DD dates (same day = 1 day).
 * Parsed as UTC midnight on both ends, so DST never shifts the result.
 */
function inclusiveDays(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Auto weekly burn rate + end-of-cycle projection from real data over the setup cycle.
 *
 * @param {object} input
 * @param {number} input.totalExpense - total spent so far in the cycle
 * @param {number} input.income - expected income for the cycle
 * @param {string} input.startDate - cycle start, YYYY-MM-DD
 * @param {string} input.endDate - cycle end, YYYY-MM-DD
 * @param {string} input.today - current date, YYYY-MM-DD (IST)
 * @returns {{weeklyRate:number, projectedSpend:number, projectedSavings:number, daysElapsed:number, totalDays:number, isEarly:boolean}}
 */
export function computeProjection({ totalExpense, income, startDate, endDate, today }) {
  const totalDays = inclusiveDays(startDate, endDate);

  // How far into the cycle we are, clamped to [1, totalDays]:
  //  - >=1 avoids divide-by-zero on day one
  //  - <=totalDays means once the cycle is over the projection equals actuals
  const rawElapsed = inclusiveDays(startDate, today);
  const daysElapsed = Math.min(Math.max(rawElapsed, 1), totalDays);

  const dailyRate = totalExpense / daysElapsed;
  const weeklyRate = Math.round(dailyRate * 7);
  const projectedSpend = Math.round(dailyRate * totalDays);
  const projectedSavings = Math.round(income - dailyRate * totalDays);

  return {
    weeklyRate,
    projectedSpend,
    projectedSavings,
    daysElapsed,
    totalDays,
    isEarly: daysElapsed < 7,
  };
}
