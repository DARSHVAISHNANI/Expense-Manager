import 'dotenv/config';
import { computeSavingsAdvice } from './calculations.js';

// Helper to format numbers cleanly (e.g., ₹10,000)
const formatCurrency = (amount) => {
  return `₹${amount.toLocaleString('en-IN')}`;
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "2026-05-25" → "25 May - Monday"  (UTC-parsed so the day-of-week is stable
 * regardless of the server's local timezone).
 */
const formatHumanDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${String(d).padStart(2, '0')} ${MONTH_ABBR[dt.getUTCMonth()]} - ${WEEKDAY_FULL[dt.getUTCDay()]}`;
};

/**
 * Formats the success message when a new entry is added.
 */
export function formatAddedEntry(parsedData, summary, displayTitle, userConfig = {}, dateCtx = {}, lastWeek = null) {
  const dateObj = new Date(parsedData.date);
  const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let text = `✅ Entry Added!\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📝 ${parsedData.name}\n`;

  if (parsedData.type === 'Transfer') {
    text += `🔄 Transfer  •  💳 ${parsedData.payment} ➡️ ${parsedData.destination}\n`;
  } else {
    text += `🏷️ ${parsedData.type}  •  💳 ${parsedData.payment}\n`;
  }

  text += `💸 ${formatCurrency(parsedData.amount)}  •  📂 ${parsedData.category}\n`;
  text += `📅 ${formattedDate}\n`;

  text += `\n${formatSummaryOnly(summary, displayTitle, userConfig, dateCtx, lastWeek)}`;

  return text;
}

/**
 * Multi-entry success message. Single entry delegates to formatAddedEntry
 * so today's detailed UX is preserved for the common case.
 */
export function formatAddedEntries(entries, summary, displayTitle, userConfig = {}, dateCtx = {}, lastWeek = null) {
  if (entries.length === 1) {
    return formatAddedEntry(entries[0], summary, displayTitle, userConfig, dateCtx, lastWeek);
  }

  let text = `✅ Added ${entries.length} entries:\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  let batchTotal = 0;
  for (const e of entries) {
    text += `• ${e.name} · ${formatCurrency(e.amount)} · ${e.payment} · ${e.category}\n`;
    if (e.type === 'Expense') batchTotal += e.amount;
  }
  text += `Batch total: ${formatCurrency(batchTotal)}\n\n`;
  text += formatSummaryOnly(summary, displayTitle, userConfig, dateCtx, lastWeek);
  return text;
}

/**
 * Formats the message for the /summary command.
 */
export function formatSummaryOnly(summary, title, userConfig = {}, dateCtx = {}, lastWeek = null) {

  const displayIncome = userConfig.income > 0 ? userConfig.income : summary.totalIncome;
  const currentSavings = displayIncome - summary.totalExpense;

  // Use the custom title passed from the bot
  let text = `📊 ${title}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 Est. Income: ${formatCurrency(displayIncome)}\n`;
  text += `💸 Total Spent: ${formatCurrency(summary.totalExpense)}\n`;
  // This is income minus spending — a savings/progress figure, NOT cash on hand.
  // (Real money on hand is the "Total Cash" line below.)
  text += `💼 Net (Income − Spent): ${formatCurrency(currentSavings)}\n`;

  // SAVINGS GOAL: shown directly below Net since it's a net-vs-target check.
  if (userConfig.savingsTarget > 0) {
    const savingsLeftToTarget = currentSavings - userConfig.savingsTarget;
    text += `🎯 Savings Goal: ${formatCurrency(userConfig.savingsTarget)}\n`;
    text += savingsLeftToTarget >= 0
      ? `✅ On Track! (+${formatCurrency(savingsLeftToTarget)})\n`
      : `⚠️ Warning: Short by ${formatCurrency(Math.abs(savingsLeftToTarget))}\n`;
  }

  // 1. ALWAYS SHOW LIVE BALANCES (Opening Balance + Notion Transactions)
  const hdfcLive = (userConfig.hdfcInit || 0) + (summary.accountBalances?.['HDFC'] || 0);
  const sbiLive = (userConfig.sbiInit || 0) + (summary.accountBalances?.['SBI'] || 0);
  const cashLive = (userConfig.cashInit || 0) + (summary.accountBalances?.['Cash'] || 0);
  const totalCash = hdfcLive + sbiLive + cashLive;

  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `🏦 Live Balances:\n`;
  text += `💳 HDFC: ${formatCurrency(hdfcLive)}\n`;
  text += `🏛️ SBI: ${formatCurrency(sbiLive)}\n`;
  text += `💵 Cash: ${formatCurrency(cashLive)}\n`;
  text += `🏦 Total Cash: ${formatCurrency(totalCash)}\n`;

  // 1a. LAST WEEK PER-DAY BREAKDOWN (rent excluded). Skipped on zero-spend weeks.
  if (lastWeek && lastWeek.total > 0) {
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📅 Last Week (${formatHumanDate(lastWeek.startDate)} → ${formatHumanDate(lastWeek.endDate)}, excl. rent):\n`;
    for (const d of lastWeek.days) {
      if (d.total === 0) continue; // skip zero-spend days — cleaner read
      text += `  ${formatHumanDate(d.date)}: ${formatCurrency(d.total)}\n`;
    }
    text += `  ─────────────────\n`;
    text += `  Weekly total: ${formatCurrency(lastWeek.total)}\n`;

    // Savings advice — only meaningful when target is set and cycle has dates.
    if (userConfig.savingsTarget > 0 && dateCtx.endDate && dateCtx.today) {
      const advice = computeSavingsAdvice({
        income: displayIncome,
        totalExpense: summary.totalExpense,
        savingsTarget: userConfig.savingsTarget,
        endDate: dateCtx.endDate,
        today: dateCtx.today,
        lastWeekTotal: lastWeek.total,
      });

      if (!advice.cycleEnded) {
        const weeksLeftStr = advice.weeksLeftInCycle >= 1
          ? `${advice.weeksLeftInCycle.toFixed(1)} weeks`
          : `${advice.daysLeft} days`;
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `🎯 Savings plan:\n`;
        text += `  Target: ${formatCurrency(userConfig.savingsTarget)} · Net so far: ${formatCurrency(advice.currentNet)}\n`;

        if (advice.availableToSpend < 0) {
          text += `  ⛔ Already ${formatCurrency(-advice.availableToSpend)} past your target — nothing left to spend this cycle.\n`;
        } else {
          text += `  You can still spend ${formatCurrency(advice.availableToSpend)} over ${weeksLeftStr}.\n`;
          text += `  ➤ Max ${formatCurrency(advice.maxWeeklySpend)}/week to hit ${formatCurrency(userConfig.savingsTarget)}.\n`;

          // Compare current pace (last week) to the cap.
          if (lastWeek.total <= advice.maxWeeklySpend) {
            const surplus = advice.surplusOverTarget;
            text += surplus > 0
              ? `  ✅ At your current ${formatCurrency(lastWeek.total)}/week pace, you'll save an extra ${formatCurrency(surplus)} on top of target.\n`
              : `  ✅ At your current ${formatCurrency(lastWeek.total)}/week pace, you'll hit target with ${formatCurrency(Math.abs(surplus))} to spare on spending.\n`;
          } else {
            const over = lastWeek.total - advice.maxWeeklySpend;
            text += `  ⚠️ Slow down — last week's ${formatCurrency(lastWeek.total)} is over by ${formatCurrency(over)}/week. Cap at ${formatCurrency(advice.maxWeeklySpend)}/week to stay on target.\n`;
          }
        }
      }
    }
  }

  // 3. ALWAYS SHOW SPENDING, BUT ONLY SHOW LIMITS IF SET
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📋 Category Breakdown:\n`;

  const getCatText = (catName, spent, limit) => {
    let str = `${catName}: ${formatCurrency(spent)}`;
    if (limit > 0) str += ` / ${formatCurrency(limit)}`;
    return str + '\n';
  };

  text += getCatText('🏠 Rent', summary.categoryTotals?.['Rent'] || 0, userConfig.rentLimit);
  text += getCatText('⚡ Elec', summary.categoryTotals?.['Electricity'] || 0, userConfig.electricityLimit);
  text += getCatText('🛒 Groc', summary.categoryTotals?.['Groceries'] || 0, userConfig.groceriesLimit);
  text += getCatText('🍔 Food', summary.categoryTotals?.['Food'] || 0, userConfig.foodLimit);
  text += getCatText('🧾 Bills', summary.categoryTotals?.['Bills'] || 0, userConfig.billsLimit);
  text += getCatText('🚗 Trav', summary.categoryTotals?.['Transportation'] || 0, userConfig.travelLimit);

  // Friendly reminder if they restarted the server
  if (!userConfig.savingsTarget) {
    text += `\n*(Type /setup to add budget limits)*`;
  }

  return text;
}

const BAR_FILL = '█';
const BAR_EMPTY = '░';

/**
 * ASCII bar chart of daily spend. Bars scale to the window's max day so the
 * rhythm of high/low days is visible at a glance.
 */
export function renderDailyChart(days, { width = 12 } = {}) {
  const total = days.reduce((s, d) => s + d.total, 0);
  if (total === 0) {
    return `📊 Daily Spend (${days.length} days, excl. rent)\nNo spend in this window.`;
  }
  const max = Math.max(...days.map(d => d.total));
  const peak = days.reduce((best, d) => (d.total > best.total ? d : best), days[0]);

  let text = `📊 Daily Spend (${days.length} days, excl. rent)\n`;
  for (const d of days) {
    const filled = max > 0 ? Math.round((d.total / max) * width) : 0;
    const bar = BAR_FILL.repeat(filled) + BAR_EMPTY.repeat(width - filled);
    text += `${d.date.slice(5)} ${d.weekday} ${bar}  ${formatCurrency(d.total)}\n`;
  }
  const avg = Math.round(total / days.length);
  text += `─────────────────────────────\n`;
  text += `Total: ${formatCurrency(total)} · Avg: ${formatCurrency(avg)}/day · Peak: ${peak.date.slice(5)} ${formatCurrency(peak.total)}`;
  return text;
}

/**
 * Renders a /query response in a human-readable narrative form.
 * - Header adapts to single-day vs range, keyword vs open question.
 * - Full details per entry: name, amount, payment, category, and notes if any.
 * - Total is summed across non-excluded Expense rows only — income and
 *   excluded rows are shown but don't add to the total.
 */
export function formatQueryResult(matches, keyword, startDate, endDate) {
  const singleDay = startDate === endDate;
  const rangeStr = singleDay ? formatHumanDate(startDate) : `${formatHumanDate(startDate)} → ${formatHumanDate(endDate)}`;
  const headerSubject = keyword
    ? `"${keyword}"`
    : (singleDay ? 'all spending' : 'all transactions');

  let text = `🔎 ${headerSubject} · ${rangeStr}\n`;

  if (matches.length === 0) {
    text += `No matches.`;
    return text;
  }

  const expenseTotal = matches
    .filter(m => m.type === 'Expense' && !m.excluded)
    .reduce((s, m) => s + m.amount, 0);
  const incomeTotal = matches
    .filter(m => m.type === 'Income' && !m.excluded)
    .reduce((s, m) => s + m.amount, 0);

  text += `Found ${matches.length} ${matches.length === 1 ? 'entry' : 'entries'}`;
  if (expenseTotal > 0) text += ` · spent ${formatCurrency(expenseTotal)}`;
  if (incomeTotal > 0) text += ` · received ${formatCurrency(incomeTotal)}`;
  text += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Group by date so range queries read like a diary.
  const byDate = new Map();
  for (const m of matches) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }

  for (const [date, entries] of byDate) {
    if (!singleDay) text += `\n${formatHumanDate(date)}\n`;
    for (const m of entries) {
      const tag = m.excluded ? ' _(excluded)_' : m.type !== 'Expense' ? ` _(${m.type})_` : '';
      text += `  • ${m.name} — ${formatCurrency(m.amount)} · ${m.payment} · ${m.category}${tag}\n`;
      if (m.notes && m.notes.trim()) {
        text += `      ↳ ${m.notes.trim()}\n`;
      }
    }
  }

  return text;
}

/**
 * Formats error messages cleanly.
 */
export function formatError(message) {
  return `❌ ${message}`;
}
