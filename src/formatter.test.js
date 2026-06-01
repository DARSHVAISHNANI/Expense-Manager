import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSummaryOnly } from './formatter.js';

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
