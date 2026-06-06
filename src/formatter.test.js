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

test('formatSummaryOnly renders the weekly burn + projection block from the cycle dates', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // 1000 over 7 days of a 28-day cycle -> 1000/week, 4000 projected spend, 6000 projected savings.
  assert.match(out, /Weekly Burn: ₹1,000\/week/);
  assert.match(out, /Projected Spend \(cycle end\): ₹4,000/);
  assert.match(out, /Projected Savings: ₹6,000/);
});

test('formatSummaryOnly shows the weekly spending limit needed to keep the savings target', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // Allowance = (10000 income - 5000 target) - 1000 spent = 4000, over 21 days / 3 weeks -> ~1333/week.
  assert.match(out, /To keep ₹5,000: spend ≤ ₹1,333\/week \(21 days left\)/);
  // Actual pace 1000/week <= 1333/week limit -> within budget.
  assert.match(out, /within budget/);
});

test('formatSummaryOnly warns to slow down when the pace exceeds the weekly limit', () => {
  // Spent 4000 in week 1: allowance = (10000 - 5000) - 4000 = 1000 over 3 weeks -> 333/week,
  // but the actual pace is 4000/week -> over budget guidance.
  const heavy = { ...summary, totalExpense: 4000, categoryTotals: { Food: 4000 } };
  const out = formatSummaryOnly(heavy, 'Test Summary', userConfig, dateCtx);
  assert.match(out, /Slow down/);
});

test('formatSummaryOnly omits the projection block when cycle dates are missing', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, {});
  assert.doesNotMatch(out, /Weekly Burn/);
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

test('formatSummaryOnly: shows Last Week block when lastWeek has spend', () => {
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
  assert.ok(out.includes('Last Week (Mon–Sun, excl. rent)'));
  assert.ok(out.includes('Mon 06-01'));
  assert.ok(out.includes('Total: ₹4,500'));
  assert.ok(out.includes('Projected monthly (×30/7): ₹19,286'));
});

test('formatSummaryOnly: omits Last Week block when total is zero', () => {
  const lastWeek = { startDate: '2026-06-01', endDate: '2026-06-07', days: [], total: 0, projectedMonthly: 0 };
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx, lastWeek);
  assert.ok(!out.includes('Last Week'));
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

test('formatQueryResult: shows total and recent matches', () => {
  const matches = [
    { name: 'mcd burger', amount: 85, date: '2026-06-05', type: 'Expense', payment: 'Cash', excluded: false },
    { name: 'mcd fries', amount: 35, date: '2026-06-03', type: 'Expense', payment: 'SBI', excluded: false },
  ];
  const out = formatQueryResult(matches, 'mcd', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('Matches: 2 entries'));
  assert.ok(out.includes('Total spent: ₹120'));
  assert.ok(out.includes('mcd burger'));
});

test('formatQueryResult: empty match list', () => {
  const out = formatQueryResult([], 'taco', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('No matches'));
});

test('formatQueryResult: excluded rows shown with tag, not in total', () => {
  const matches = [
    { name: 'mcd', amount: 100, date: '2026-06-01', type: 'Expense', payment: 'Cash', excluded: true },
    { name: 'mcd', amount: 50, date: '2026-06-02', type: 'Expense', payment: 'Cash', excluded: false },
  ];
  const out = formatQueryResult(matches, 'mcd', '2026-06-01', '2026-06-30');
  assert.ok(out.includes('Total spent: ₹50'));
  assert.ok(out.includes('(excluded)'));
});
