import { test } from 'node:test';
import assert from 'node:assert/strict';

import { backSolveInit, computeProjection, computeWeeklyAllowance, previousCycleWeek, computeLastWeek, computeDailyTotals, computeSavingsAdvice } from './calculations.js';
import { isCountableExpense } from './notion.js';

const mkPage = (date, amount, { category = 'Food', type = 'Expense', excluded = false } = {}) => ({
  properties: {
    Date: { date: { start: date } },
    Amount: { number: amount },
    Category: { select: { name: category } },
    Type: { select: { name: type } },
    Exclude: { checkbox: excluded },
  },
});

// --- isCountableExpense: shared filter for what counts toward spending totals ---

const makePage = ({ type = 'Expense', category = 'Food', excluded = false } = {}) => ({
  properties: {
    Type: { select: { name: type } },
    Category: { select: { name: category } },
    Exclude: { checkbox: excluded },
  },
});

test('isCountableExpense: includes a plain expense', () => {
  assert.strictEqual(isCountableExpense(makePage()), true);
});

test('isCountableExpense: skips income', () => {
  assert.strictEqual(isCountableExpense(makePage({ type: 'Income' })), false);
});

test('isCountableExpense: skips transfers', () => {
  assert.strictEqual(isCountableExpense(makePage({ type: 'Transfer' })), false);
});

test('isCountableExpense: skips excluded rows', () => {
  assert.strictEqual(isCountableExpense(makePage({ excluded: true })), false);
});

test('isCountableExpense: skips rent by default', () => {
  assert.strictEqual(isCountableExpense(makePage({ category: 'Rent' })), false);
});

test('isCountableExpense: includes rent when excludeRent=false', () => {
  assert.strictEqual(isCountableExpense(makePage({ category: 'Rent' }), { excludeRent: false }), true);
});

// --- S-1: Back-solve the stored opening balance from a typed CURRENT balance ---
// Invariant we care about: storedInit + delta === typedCurrentBalance
// so that Live Balance reads the typed number immediately and never double-counts.

test('backSolveInit returns the typed balance when there are no transactions yet', () => {
  assert.equal(backSolveInit(10000, 0), 10000);
});

test('backSolveInit cancels out a net spend so Live Balance equals the typed balance', () => {
  // User spent a net 2000 in the cycle (delta = -2000) and types their real balance of 10000.
  const init = backSolveInit(10000, -2000);
  assert.equal(init, 12000);
  // Live = storedInit + delta must reproduce the typed balance.
  assert.equal(init + (-2000), 10000);
});

test('backSolveInit cancels out a net income so Live Balance equals the typed balance', () => {
  const init = backSolveInit(5000, 3000); // net +3000 from income/transfers in
  assert.equal(init, 2000);
  assert.equal(init + 3000, 5000);
});

// --- S-2: Weekly burn rate + month-end projection from real data over the setup cycle ---

test('computeProjection: 1000 spent in week 1 of a 4-week cycle projects to 4000 spend / 6000 savings', () => {
  const r = computeProjection({
    totalExpense: 1000,
    income: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28', // 28 days inclusive = 4 weeks
    today: '2026-05-07',   // 7 days elapsed = 1 week
  });
  assert.equal(r.totalDays, 28);
  assert.equal(r.daysElapsed, 7);
  assert.equal(r.weeklyRate, 1000);
  assert.equal(r.projectedSpend, 4000);
  assert.equal(r.projectedSavings, 6000);
  assert.equal(r.isEarly, false); // exactly 7 days is not "early"
});

test('computeProjection: flags an early estimate when fewer than 7 days have elapsed', () => {
  const r = computeProjection({
    totalExpense: 500,
    income: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-05-03', // 3 days elapsed
  });
  assert.equal(r.daysElapsed, 3);
  assert.equal(r.isEarly, true);
});

test('computeProjection: clamps days elapsed to 1 when today is before the cycle start', () => {
  const r = computeProjection({
    totalExpense: 0,
    income: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-04-25', // before start
  });
  assert.equal(r.daysElapsed, 1);
  assert.equal(r.weeklyRate, 0);
  assert.equal(r.projectedSpend, 0);
  assert.equal(r.projectedSavings, 10000);
});

test('computeProjection: after the cycle ends, projected spend equals actual spend', () => {
  const r = computeProjection({
    totalExpense: 3500,
    income: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-06-15', // after end
  });
  assert.equal(r.daysElapsed, 28); // clamped to totalDays
  assert.equal(r.projectedSpend, 3500); // = actual, no overrun
  assert.equal(r.projectedSavings, 6500);
});

test('computeProjection: zero spending projects zero spend and full income as savings', () => {
  const r = computeProjection({
    totalExpense: 0,
    income: 8000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-05-14',
  });
  assert.equal(r.weeklyRate, 0);
  assert.equal(r.projectedSpend, 0);
  assert.equal(r.projectedSavings, 8000);
});

// --- Weekly spending allowance: how much you can still spend per remaining week
//     and finish the cycle with at least your savings target left (as net). ---

test('computeWeeklyAllowance: the user example — 35k income, 1k spent, 10k target, 3 weeks left -> 8000/week', () => {
  const r = computeWeeklyAllowance({
    income: 35000,
    totalExpense: 1000,
    savingsTarget: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28', // 28 days = 4 weeks
    today: '2026-05-07',   // 7 days in -> 21 days / 3 weeks remain
  });
  assert.equal(r.remainingAllowance, 24000); // (35000 - 10000) - 1000
  assert.equal(r.remainingDays, 21);
  assert.equal(r.weeklyAllowance, 8000);
  assert.equal(r.overBudget, false);
  assert.equal(r.cycleEnded, false);
});

test('computeWeeklyAllowance: flags overBudget when you have already spent past what the target allows', () => {
  const r = computeWeeklyAllowance({
    income: 35000,
    totalExpense: 30000,
    savingsTarget: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-05-07',
  });
  // (35000 - 10000) - 30000 = -5000 -> no room left
  assert.equal(r.remainingAllowance, -5000);
  assert.equal(r.overBudget, true);
});

test('computeWeeklyAllowance: flags cycleEnded and gives no weekly figure once the cycle is over', () => {
  const r = computeWeeklyAllowance({
    income: 35000,
    totalExpense: 1000,
    savingsTarget: 10000,
    startDate: '2026-05-01',
    endDate: '2026-05-28',
    today: '2026-06-10', // past the end
  });
  assert.equal(r.remainingDays, 0);
  assert.equal(r.cycleEnded, true);
  assert.equal(r.weeklyAllowance, null);
});

// --- previousCycleWeek: cycle-anchored week, never crosses into previous month ---

test('previousCycleWeek: cycle May 25, today Jun 5 → last week is May 25-31 (week 1)', () => {
  // Cycle started May 25. Week 1 = May 25-31. Today is in week 2 (Jun 1-7).
  // Most recently COMPLETED week is week 1.
  assert.deepStrictEqual(
    previousCycleWeek({ cycleStart: '2026-05-25', today: '2026-06-05' }),
    { start: '2026-05-25', end: '2026-05-31' }
  );
});

test('previousCycleWeek: cycle May 25, today Jun 8 → last week is Jun 1-7 (week 2 just completed)', () => {
  // Jun 8 is day 14 (day 0 = May 25), so 2 full weeks have completed.
  assert.deepStrictEqual(
    previousCycleWeek({ cycleStart: '2026-05-25', today: '2026-06-08' }),
    { start: '2026-06-01', end: '2026-06-07' }
  );
});

test('previousCycleWeek: less than 7 days into cycle → null (no completed week yet)', () => {
  // Today = May 30, cycle start = May 25. Only 5 full days in. Not even week 1 done.
  assert.strictEqual(previousCycleWeek({ cycleStart: '2026-05-25', today: '2026-05-30' }), null);
});

test('previousCycleWeek: on the exact end-of-week-1 day → week 1 is the last completed', () => {
  // Cycle May 25. May 31 is day 6, end of week 1. Today May 31 → week 1 just completed.
  assert.deepStrictEqual(
    previousCycleWeek({ cycleStart: '2026-05-25', today: '2026-05-31' }),
    { start: '2026-05-25', end: '2026-05-31' }
  );
});

// --- computeLastWeek: per-day aggregation across the cycle-anchored week ---

test('computeLastWeek: cycle May 25, today Jun 8 → aggregates Jun 1-7 (week 2)', () => {
  const pages = [
    mkPage('2026-06-01', 1000),
    mkPage('2026-06-02', 500),
    mkPage('2026-06-03', 700),
    mkPage('2026-06-03', 300), // same day, additive
    mkPage('2026-06-05', 450),
    mkPage('2026-06-06', 1200),
    mkPage('2026-06-07', 650),
    mkPage('2026-06-05', 15000, { category: 'Rent' }), // dropped
    mkPage('2026-06-06', 200, { excluded: true }),     // dropped
    mkPage('2026-06-06', 500, { type: 'Income' }),     // dropped
    mkPage('2026-05-31', 9999),                         // pre-window, dropped
  ];
  const r = computeLastWeek({ pages, cycleStart: '2026-05-25', today: '2026-06-08' });
  assert.strictEqual(r.startDate, '2026-06-01');
  assert.strictEqual(r.endDate, '2026-06-07');
  assert.strictEqual(r.days.length, 7);
  assert.deepStrictEqual(r.days.map(d => d.total), [1000, 500, 1000, 0, 450, 1200, 650]);
  assert.strictEqual(r.total, 4800);
  assert.strictEqual(r.projectedMonthly, Math.round((4800 * 30) / 7));
});

test('computeLastWeek: returns null when no full cycle-week has elapsed yet', () => {
  const r = computeLastWeek({ pages: [], cycleStart: '2026-05-25', today: '2026-05-28' });
  assert.strictEqual(r, null);
});

// --- computeSavingsAdvice: target-aware weekly cap and surplus projection ---

test('computeSavingsAdvice: 17k net, 10k target, 28 days left, 1k/wk pace → max 1.75k/wk, +3k surplus', () => {
  // income=20k, spent=3k → net=17k. Target=10k → 7k available.
  // Days left ~28 (4 weeks). Max = 7000/4 = 1750.
  // At 1000/wk for 4 weeks → spend 4000 more → end-net = 17000 - 4000 = 13000.
  // Surplus = 13000 - 10000 = 3000.
  const r = computeSavingsAdvice({
    income: 20000,
    totalExpense: 3000,
    savingsTarget: 10000,
    endDate: '2026-06-30',
    today: '2026-06-02',
    lastWeekTotal: 1000,
  });
  assert.strictEqual(r.currentNet, 17000);
  assert.strictEqual(r.availableToSpend, 7000);
  assert.strictEqual(r.daysLeft, 28);
  assert.strictEqual(r.maxWeeklySpend, 1750);
  assert.strictEqual(r.projectedSavingsAtCurrentPace, 13000);
  assert.strictEqual(r.surplusOverTarget, 3000);
  assert.strictEqual(r.cycleEnded, false);
});

test('computeSavingsAdvice: over-budget pace flags surplus < 0', () => {
  const r = computeSavingsAdvice({
    income: 20000,
    totalExpense: 3000,
    savingsTarget: 10000,
    endDate: '2026-06-30',
    today: '2026-06-02',
    lastWeekTotal: 2500, // way over 1750/wk cap
  });
  assert.strictEqual(r.surplusOverTarget < 0, true);
});

test('computeSavingsAdvice: cycle ended → maxWeeklySpend null, cycleEnded true', () => {
  const r = computeSavingsAdvice({
    income: 20000,
    totalExpense: 3000,
    savingsTarget: 10000,
    endDate: '2026-05-30',
    today: '2026-06-10',
    lastWeekTotal: 1000,
  });
  assert.strictEqual(r.cycleEnded, true);
  assert.strictEqual(r.maxWeeklySpend, null);
});

// --- computeDailyTotals: per-day over an arbitrary inclusive range ---

test('computeDailyTotals: per-day totals, fills missing days with 0, drops rent', () => {
  const pages = [
    mkPage('2026-06-05', 100),
    mkPage('2026-06-05', 200),
    mkPage('2026-06-07', 50),
    mkPage('2026-06-07', 5000, { category: 'Rent' }), // dropped
  ];
  const r = computeDailyTotals(pages, '2026-06-05', '2026-06-08');
  assert.deepStrictEqual(r.map(d => [d.date, d.total]), [
    ['2026-06-05', 300],
    ['2026-06-06', 0],
    ['2026-06-07', 50],
    ['2026-06-08', 0],
  ]);
  assert.ok(r.every(d => typeof d.weekday === 'string'));
});
