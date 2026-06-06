import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSummaryOnly, formatAddedEntries, renderDailyChart, formatQueryResult } from './formatter.js';

// A representative summary as returned by getDateRangeSummary().
const summary = {
  totalExpense: 1000,
  totalIncome: 0,
  balance: -1000,
  categoryTotals: { Food: 1000 },
  accountBalances: { HDFC: -1000, SBI: 0, "Parent's Paid": 0, Cash: 0 },
};

const userConfig = {
  income: 10000,
  hdfcInit: 6000, // opening balance (already back-solved)
  sbiInit: 2000,
  cashInit: 500,
  savingsTarget: 5000,
};

const dateCtx = { startDate: '2026-05-01', endDate: '2026-05-28', today: '2026-05-07' };

test('formatSummaryOnly renders Live Balances as init + transaction delta', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // HDFC: 6000 + (-1000) = 5000
  assert.match(out, /HDFC: ₹5,000/);
  assert.match(out, /SBI: ₹2,000/);
  assert.match(out, /Cash: ₹500/);
});

test('formatSummaryOnly shows Total Cash as the sum of all Live Balances', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // 5000 + 2000 + 500 = 7500 (real money on hand)
  assert.match(out, /Total Cash: ₹7,500/);
});

test('formatSummaryOnly labels the income-minus-spent figure as Net, not a cash balance', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // 10000 income - 1000 spent = 9000
  assert.match(out, /Net \(Income − Spent\): ₹9,000/);
  // The old misleading label must be gone.
  assert.doesNotMatch(out, /Current Bal/);
});

test('formatSummaryOnly: no longer renders the old Weekly Burn / Projected block', () => {
  // These were removed — only the cycle-anchored "Last Week" + "Savings plan"
  // blocks survive (and only when lastWeek is passed in).
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  assert.doesNotMatch(out, /Weekly Burn/);
  assert.doesNotMatch(out, /Projected Spend/);
  assert.doesNotMatch(out, /Projected Savings/);
});

test('formatSummaryOnly places the Savings Goal block right after Net, before Live Balances', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  const netIdx = out.indexOf('Net (Income');
  const goalIdx = out.indexOf('Savings Goal');
  const liveIdx = out.indexOf('Live Balances');
  assert.ok(netIdx >= 0 && goalIdx >= 0 && liveIdx >= 0, 'all three blocks must be present');
  assert.ok(netIdx < goalIdx, 'Savings Goal must come after Net');
  assert.ok(goalIdx < liveIdx, 'Savings Goal must come before Live Balances');
});

test('formatSummaryOnly always shows all six category lines', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  for (const cat of ['Rent', 'Elec', 'Groc', 'Food', 'Bills', 'Trav']) {
    assert.match(out, new RegExp(cat));
  }
});

// --- formatAddedEntries: multi-entry batch success message ---

test('formatAddedEntries: multi-entry shows batch list and summary', () => {
  const entries = [
    { name: 'mcd', type: 'Expense', amount: 35, payment: 'Cash', category: 'Food', date: '2026-06-07' },
    { name: 'taco bell', type: 'Expense', amount: 45, payment: 'SBI', category: 'Food', date: '2026-06-07' },
  ];
  const localSummary = { totalExpense: 80, totalIncome: 0, balance: -80, categoryTotals: { Food: 80 }, accountBalances: {} };
  const out = formatAddedEntries(entries, localSummary, 'Test', {}, {});
  assert.ok(out.includes('Added 2 entries'));
  assert.ok(out.includes('mcd'));
  assert.ok(out.includes('taco bell'));
  assert.ok(out.includes('Batch total: ₹80'));
});

test('formatAddedEntries: single entry uses detailed format', () => {
  const entries = [{ name: 'mcd', type: 'Expense', amount: 35, payment: 'Cash', category: 'Food', date: '2026-06-07' }];
  const localSummary = { totalExpense: 35, totalIncome: 0, balance: -35, categoryTotals: { Food: 35 }, accountBalances: {} };
  const out = formatAddedEntries(entries, localSummary, 'Test', {}, {});
  assert.ok(out.includes('📝 mcd'));
  assert.ok(!out.includes('Added 1 entries'));
});

// --- Last-week section in /summary ---

test('formatSummaryOnly: shows Last Week block with human-readable per-day rows', () => {
  const lastWeek = {
    startDate: '2026-06-01', endDate: '2026-06-07',
    days: [
      { date: '2026-06-01', weekday: 'Mon', total: 1000 },
      { date: '2026-06-02', weekday: 'Tue', total: 500 },
      { date: '2026-06-03', weekday: 'Wed', total: 700 },
      { date: '2026-06-04', weekday: 'Thu', total: 0 },
      { date: '2026-06-05', weekday: 'Fri', total: 450 },
      { date: '2026-06-06', weekday: 'Sat', total: 1200 },
      { date: '2026-06-07', weekday: 'Sun', total: 650 },
    ],
    total: 4500, projectedMonthly: 19286,
  };
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx, lastWeek);
  assert.ok(out.includes('Last Week (01 Jun - Monday → 07 Jun - Sunday'));
  // New human-readable date row format: "01 Jun - Monday: ₹1,000"
  assert.ok(out.includes('01 Jun - Monday: ₹1,000'));
  assert.ok(out.includes('05 Jun - Friday: ₹450'));
  assert.ok(out.includes('Weekly total: ₹4,500'));
  // Zero-spend days should be skipped from the list, but total still includes them.
  assert.ok(!out.includes('04 Jun - Thursday: ₹0'));
});

test('formatSummaryOnly: omits Last Week block when total is zero', () => {
  const lastWeek = { startDate: '2026-06-01', endDate: '2026-06-07', days: [], total: 0, projectedMonthly: 0 };
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx, lastWeek);
  assert.ok(!out.includes('Last Week'));
});

test('formatSummaryOnly: includes savings plan recommendation when target + lastWeek + dates are set', () => {
  // userConfig income=10k, savingsTarget=5k. summary.totalExpense=1k → net=9k.
  // Available = 9k - 5k = 4k. dateCtx today=2026-05-07 end=2026-05-28 → 21 days left = 3 weeks.
  // Max ≈ 4000/3 ≈ 1333/wk. Last week pace 1k → under cap → surplus.
  const lastWeek = {
    startDate: '2026-04-29', endDate: '2026-05-05',
    days: [{ date: '2026-05-05', weekday: 'Mon', total: 1000 }],
    total: 1000, projectedMonthly: 4286,
  };
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx, lastWeek);
  assert.ok(out.includes('Savings plan'));
  assert.ok(out.includes('Max ₹1,333/week to hit ₹5,000'));
  assert.ok(out.match(/save an extra ₹[\d,]+ on top of target/));

  // The plan block should NOT repeat target/net — those already appear in the
  // Savings Goal block right after Net at the top.
  const planIdx = out.indexOf('Savings plan');
  const planBlock = out.slice(planIdx);
  assert.ok(!planBlock.includes('Net so far'));
  assert.ok(!/Target: ₹/.test(planBlock));
});

test('formatSummaryOnly: warns to slow down when last-week pace is over the cap', () => {
  // 5000/wk spent, way over the 1333/wk cap.
  const lastWeek = {
    startDate: '2026-04-29', endDate: '2026-05-05',
    days: [{ date: '2026-05-05', weekday: 'Mon', total: 5000 }],
    total: 5000, projectedMonthly: 21429,
  };
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx, lastWeek);
  assert.ok(out.includes('Slow down'));
  assert.ok(out.includes('₹3,667/week'));
});

// --- renderDailyChart: ASCII bar chart ---

test('renderDailyChart: scales bars to max, shows total/avg/peak', () => {
  const days = [
    { date: '2026-06-01', weekday: 'Mon', total: 100 },
    { date: '2026-06-02', weekday: 'Tue', total: 0 },
    { date: '2026-06-03', weekday: 'Wed', total: 200 }, // peak
  ];
  const out = renderDailyChart(days);
  assert.ok(out.includes('06-01 Mon'));
  assert.ok(out.includes('₹200'));
  assert.ok(out.includes('Total: ₹300'));
  assert.ok(out.includes('Avg: ₹100/day'));
  assert.ok(out.includes('Peak: 06-03'));
});

test('renderDailyChart: zero-spend window says so', () => {
  const days = [
    { date: '2026-06-01', weekday: 'Mon', total: 0 },
    { date: '2026-06-02', weekday: 'Tue', total: 0 },
  ];
  const out = renderDailyChart(days);
  assert.ok(out.includes('No spend'));
});

// --- formatQueryResult ---

test('formatQueryResult: keyword search shows totals and grouped entries with notes', () => {
  const matches = [
    { name: 'mcd burger', notes: 'with friends', amount: 85, date: '2026-06-05', type: 'Expense', payment: 'Cash', category: 'Food', excluded: false },
    { name: 'mcd fries', notes: '', amount: 35, date: '2026-06-03', type: 'Expense', payment: 'SBI', category: 'Food', excluded: false },
  ];
  const out = formatQueryResult(matches, 'mcd', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('"mcd"'));
  assert.ok(out.includes('Found 2 entries'));
  assert.ok(out.includes('spent ₹120'));
  assert.ok(out.includes('mcd burger — ₹85 · Cash · Food'));
  assert.ok(out.includes('↳ with friends')); // notes rendered as continuation
});

test('formatQueryResult: open question (empty keyword) lists every transaction with full detail', () => {
  const matches = [
    { name: 'mcd', notes: 'lunch', amount: 100, date: '2026-06-01', type: 'Expense', payment: 'Cash', category: 'Food', excluded: false },
    { name: 'salary', notes: 'monthly', amount: 50000, date: '2026-06-01', type: 'Income', payment: 'HDFC', category: 'Salary', excluded: false },
  ];
  const out = formatQueryResult(matches, '', '2026-06-01', '2026-06-01');
  assert.ok(out.includes('all spending')); // single-day → "all spending"
  assert.ok(out.includes('01 Jun - Monday'));
  assert.ok(out.includes('mcd — ₹100'));
  assert.ok(out.includes('salary — ₹50,000'));
  assert.ok(out.includes('received ₹50,000'));
});

test('formatQueryResult: range with empty keyword says "all transactions"', () => {
  const matches = [
    { name: 'mcd', notes: '', amount: 50, date: '2026-06-05', type: 'Expense', payment: 'Cash', category: 'Food', excluded: false },
  ];
  const out = formatQueryResult(matches, '', '2026-06-01', '2026-06-07');
  assert.ok(out.includes('all transactions'));
  assert.ok(out.includes('→')); // date range arrow
});

test('formatQueryResult: empty match list', () => {
  const out = formatQueryResult([], 'taco', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('No matches'));
});

test('formatQueryResult: excluded rows shown with tag, not in spent total', () => {
  const matches = [
    { name: 'mcd', notes: '', amount: 100, date: '2026-06-01', type: 'Expense', payment: 'Cash', category: 'Food', excluded: true },
    { name: 'mcd', notes: '', amount: 50, date: '2026-06-02', type: 'Expense', payment: 'Cash', category: 'Food', excluded: false },
  ];
  const out = formatQueryResult(matches, 'mcd', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('spent ₹50'));
  assert.ok(out.includes('_(excluded)_'));
});
