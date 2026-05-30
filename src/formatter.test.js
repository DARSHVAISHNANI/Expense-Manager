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

test('formatSummaryOnly renders the weekly burn + projection block from the cycle dates', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, dateCtx);
  // 1000 over 7 days of a 28-day cycle -> 1000/week, 4000 projected spend, 6000 projected savings.
  assert.match(out, /Weekly Burn: ₹1,000\/week/);
  assert.match(out, /Projected Spend \(cycle end\): ₹4,000/);
  assert.match(out, /Projected Savings: ₹6,000/);
  // Projected savings 6000 >= target 5000 -> on pace.
  assert.match(out, /On pace/);
});

test('formatSummaryOnly omits the projection block when cycle dates are missing', () => {
  const out = formatSummaryOnly(summary, 'Test Summary', userConfig, {});
  assert.doesNotMatch(out, /Weekly Burn/);
});
