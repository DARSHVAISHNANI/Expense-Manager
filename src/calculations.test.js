import { test } from 'node:test';
import assert from 'node:assert/strict';

import { backSolveInit, computeProjection, computeWeeklyAllowance, previousMondaySunday, computeLastWeek, computeDailyTotals } from './calculations.js';
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

// --- previousMondaySunday: returns the most recent FULLY-completed Mon-Sun ---

test('previousMondaySunday: Wednesday 2026-06-10 returns prev Mon-Sun (Jun 1-7)', () => {
  assert.deepStrictEqual(previousMondaySunday('2026-06-10'), { start: '2026-06-01', end: '2026-06-07' });
});

test('previousMondaySunday: Monday 2026-06-08 returns prev Mon-Sun (Jun 1-7)', () => {
  assert.deepStrictEqual(previousMondaySunday('2026-06-08'), { start: '2026-06-01', end: '2026-06-07' });
});

test('previousMondaySunday: Sunday 2026-06-07 returns the WEEK BEFORE (May 25-31)', () => {
  // Sunday — the current week ends today but it's only just "completed", we want
  // the previous fully-completed window.
  assert.deepStrictEqual(previousMondaySunday('2026-06-07'), { start: '2026-05-25', end: '2026-05-31' });
});

test('previousMondaySunday: month boundary 2026-07-01 (Wed) crosses back into June', () => {
  assert.deepStrictEqual(previousMondaySunday('2026-07-01'), { start: '2026-06-22', end: '2026-06-28' });
});

// --- computeLastWeek: per-day aggregation, rent excluded, monthly projection ---

test('computeLastWeek: aggregates per-day, drops rent + excluded + income, projects monthly', () => {
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
  ];
  const r = computeLastWeek({ pages, today: '2026-06-10' });
  assert.strictEqual(r.startDate, '2026-06-01');
  assert.strictEqual(r.endDate, '2026-06-07');
  assert.strictEqual(r.days.length, 7);
  assert.deepStrictEqual(r.days.map(d => d.total), [1000, 500, 1000, 0, 450, 1200, 650]);
  assert.strictEqual(r.total, 4800);
  assert.strictEqual(r.projectedMonthly, Math.round((4800 * 30) / 7));
});

test('computeLastWeek: empty pages → total 0 and projection 0, still 7 days', () => {
  const r = computeLastWeek({ pages: [], today: '2026-06-10' });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.projectedMonthly, 0);
  assert.strictEqual(r.days.length, 7);
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
