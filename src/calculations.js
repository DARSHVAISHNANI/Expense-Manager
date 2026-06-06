// Pure calculation helpers — no Notion, no Telegram, fully unit-testable.

import { isCountableExpense } from './notion.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatDate = (dt) =>
  `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

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

/**
 * How much you can still spend per remaining week and finish the cycle with at
 * least your savings target left (measured as net = income − total spending).
 *
 * Allowed remaining spend = (income − savingsTarget) − totalExpense, spread over
 * the weeks left in the cycle.
 *
 * @param {object} input
 * @param {number} input.income - expected income for the cycle
 * @param {number} input.totalExpense - total spent so far in the cycle
 * @param {number} input.savingsTarget - net you want to have left at cycle end
 * @param {string} input.startDate - cycle start, YYYY-MM-DD
 * @param {string} input.endDate - cycle end, YYYY-MM-DD
 * @param {string} input.today - current date, YYYY-MM-DD (IST)
 * @returns {{remainingAllowance:number, remainingDays:number, remainingWeeks:number, weeklyAllowance:(number|null), overBudget:boolean, cycleEnded:boolean}}
 */
export function computeWeeklyAllowance({ income, totalExpense, savingsTarget, startDate, endDate, today }) {
  const totalDays = inclusiveDays(startDate, endDate);
  const rawElapsed = inclusiveDays(startDate, today);
  const daysElapsed = Math.min(Math.max(rawElapsed, 1), totalDays);
  const remainingDays = Math.max(totalDays - daysElapsed, 0);
  const remainingWeeks = remainingDays / 7;

  // What you can still spend and keep `savingsTarget` as net at cycle end.
  const remainingAllowance = (income - savingsTarget) - totalExpense;

  const weeklyAllowance = remainingDays > 0
    ? Math.round(remainingAllowance / remainingWeeks)
    : null;

  return {
    remainingAllowance,
    remainingDays,
    remainingWeeks,
    weeklyAllowance,
    overBudget: remainingAllowance < 0,
    cycleEnded: remainingDays <= 0,
  };
}

/**
 * Most recently FULLY-completed 7-day cycle-week relative to `today`,
 * where weeks are counted from `cycleStart` (week 1 = cycleStart..cycleStart+6,
 * week 2 = cycleStart+7..cycleStart+13, etc.). Returns null if the cycle
 * hasn't reached the end of its first week yet.
 *
 * This is what the user wants: weeks anchored to their cycle, never crossing
 * into the previous month.
 */
export function previousCycleWeek({ cycleStart, today }) {
  const startMs = Date.parse(`${cycleStart}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(todayMs)) return null;

  const daysSinceStart = Math.floor((todayMs - startMs) / DAY_MS); // 0 = on start day
  // Number of fully-completed cycle-weeks as of `today`. Today must be PAST the
  // end of week N for that week to count as completed.
  const completedWeeks = Math.floor((daysSinceStart + 1) / 7);
  if (completedWeeks < 1) return null;

  const lastWeekStartMs = startMs + (completedWeeks - 1) * 7 * DAY_MS;
  const lastWeekEndMs = lastWeekStartMs + 6 * DAY_MS;
  return { start: formatDate(new Date(lastWeekStartMs)), end: formatDate(new Date(lastWeekEndMs)) };
}

/**
 * Aggregate per-day spending across the most-recent fully-completed cycle-week
 * (weeks counted from cycleStart, not calendar Mondays). Filters out
 * non-expense, excluded, and rent rows. Returns null if no full cycle-week
 * has completed yet.
 *
 * @returns {{ startDate:string, endDate:string, days:Array<{date,weekday,total}>, total:number, projectedMonthly:number }|null}
 */
export function computeLastWeek({ pages, cycleStart, today }) {
  const range = previousCycleWeek({ cycleStart, today });
  if (!range) return null;
  const { start, end } = range;
  const startMs = Date.parse(`${start}T00:00:00Z`);

  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(startMs + i * DAY_MS);
    return { date: formatDate(dt), weekday: WEEKDAYS[dt.getUTCDay()], total: 0 };
  });

  for (const p of pages) {
    if (!isCountableExpense(p)) continue;
    const pageDate = p.properties?.Date?.date?.start;
    const amount = p.properties?.Amount?.number || 0;
    const day = days.find(d => d.date === pageDate);
    if (day) day.total += amount;
  }

  const total = days.reduce((s, d) => s + d.total, 0);
  const projectedMonthly = Math.round((total * 30) / 7);
  return { startDate: start, endDate: end, days, total, projectedMonthly };
}

/**
 * Savings-target advice from the user's actual numbers:
 * - currentNet = income − totalExpense
 * - availableToSpend = currentNet − savingsTarget (negative if already over)
 * - weeksLeftInCycle = (endDate − today) / 7 (clamped, can be fractional)
 * - maxWeeklySpend = availableToSpend / weeksLeftInCycle
 * - projectedSavingsAtCurrentPace = currentNet − lastWeekTotal × weeksLeftInCycle
 * - surplusOverTarget = projectedSavingsAtCurrentPace − savingsTarget
 */
export function computeSavingsAdvice({ income, totalExpense, savingsTarget, endDate, today, lastWeekTotal }) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const daysLeft = Math.max(0, Math.round((endMs - todayMs) / DAY_MS));
  const weeksLeftInCycle = daysLeft / 7;
  const currentNet = income - totalExpense;
  const availableToSpend = currentNet - savingsTarget;

  if (daysLeft <= 0) {
    return {
      currentNet,
      availableToSpend,
      weeksLeftInCycle: 0,
      daysLeft: 0,
      maxWeeklySpend: null,
      projectedSavingsAtCurrentPace: currentNet,
      surplusOverTarget: currentNet - savingsTarget,
      cycleEnded: true,
    };
  }

  const maxWeeklySpend = Math.round(availableToSpend / weeksLeftInCycle);
  const projectedSavingsAtCurrentPace = Math.round(currentNet - lastWeekTotal * weeksLeftInCycle);
  const surplusOverTarget = projectedSavingsAtCurrentPace - savingsTarget;

  return {
    currentNet,
    availableToSpend,
    weeksLeftInCycle,
    daysLeft,
    maxWeeklySpend,
    projectedSavingsAtCurrentPace,
    surplusOverTarget,
    cycleEnded: false,
  };
}

/**
 * Per-day expense totals over an inclusive date range. Same filter as the
 * last-week view (rent + excluded + non-expense dropped).
 */
export function computeDailyTotals(pages, startDate, endDate) {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const numDays = Math.round((endMs - startMs) / DAY_MS) + 1;

  const days = Array.from({ length: numDays }, (_, i) => {
    const dt = new Date(startMs + i * DAY_MS);
    return { date: formatDate(dt), weekday: WEEKDAYS[dt.getUTCDay()], total: 0 };
  });

  for (const p of pages) {
    if (!isCountableExpense(p)) continue;
    const pageDate = p.properties?.Date?.date?.start;
    const amount = p.properties?.Amount?.number || 0;
    const day = days.find(x => x.date === pageDate);
    if (day) day.total += amount;
  }
  return days;
}
