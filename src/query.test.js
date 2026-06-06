import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchTransactions } from './query.js';

const mk = (name, notes, amount, date, { excluded = false, type = 'Expense' } = {}) => ({
  properties: {
    Name: { title: [{ plain_text: name }] },
    Notes: { rich_text: [{ plain_text: notes }] },
    Amount: { number: amount },
    Date: { date: { start: date } },
    Type: { select: { name: type } },
    Exclude: { checkbox: excluded },
    Payment: { select: { name: 'Cash' } },
  },
});

test('matchTransactions: matches Name case-insensitively', () => {
  const pages = [mk('McDonalds burger', '', 85, '2026-06-05'), mk('Pizza Hut', '', 200, '2026-06-04')];
  const r = matchTransactions(pages, 'mcd');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].name, 'McDonalds burger');
});

test('matchTransactions: matches Notes', () => {
  const pages = [mk('snack', 'mcd combo', 100, '2026-06-05')];
  const r = matchTransactions(pages, 'mcd');
  assert.strictEqual(r.length, 1);
});

test('matchTransactions: sorted by date desc', () => {
  const pages = [
    mk('mcd a', '', 1, '2026-06-01'),
    mk('mcd b', '', 2, '2026-06-05'),
    mk('mcd c', '', 3, '2026-06-03'),
  ];
  const r = matchTransactions(pages, 'mcd');
  assert.deepStrictEqual(r.map(x => x.name), ['mcd b', 'mcd c', 'mcd a']);
});

test('matchTransactions: empty keyword returns empty', () => {
  const pages = [mk('mcd', '', 1, '2026-06-01')];
  assert.strictEqual(matchTransactions(pages, '').length, 0);
});

test('matchTransactions: includes excluded rows but tags them', () => {
  const p = mk('mcd', '', 50, '2026-06-05', { excluded: true });
  const r = matchTransactions([p], 'mcd');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].excluded, true);
});

test('matchTransactions: matches across types (income too)', () => {
  const pages = [mk('salary credit', '', 50000, '2026-06-01', { type: 'Income' })];
  const r = matchTransactions(pages, 'salary');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].type, 'Income');
});
