import 'dotenv/config';
import { computeProjection, computeWeeklyAllowance } from './calculations.js';

// Helper to format numbers cleanly (e.g., ₹10,000)
const formatCurrency = (amount) => {
  return `₹${amount.toLocaleString('en-IN')}`;
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
    text += `📅 Last Week (Mon–Sun, excl. rent):\n`;
    for (const d of lastWeek.days) {
      text += `  ${d.weekday} ${d.date.slice(5)}  ${formatCurrency(d.total)}\n`;
    }
    text += `  ─────────────────\n`;
    text += `  Total: ${formatCurrency(lastWeek.total)}\n`;
    text += `  Projected monthly (×30/7): ${formatCurrency(lastWeek.projectedMonthly)}\n`;
  }

  // 1b. WEEKLY BURN RATE + END-OF-CYCLE PROJECTION (needs the real cycle dates)
  if (dateCtx.startDate && dateCtx.endDate && dateCtx.today) {
    const { weeklyRate, projectedSpend, projectedSavings, isEarly } = computeProjection({
      totalExpense: summary.totalExpense,
      income: displayIncome,
      startDate: dateCtx.startDate,
      endDate: dateCtx.endDate,
      today: dateCtx.today,
    });

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📈 Weekly Burn: ${formatCurrency(weeklyRate)}/week${isEarly ? ' (early estimate)' : ''}\n`;
    text += `🔮 Projected Spend (cycle end): ${formatCurrency(projectedSpend)}\n`;
    text += `💰 Projected Savings: ${formatCurrency(projectedSavings)}\n`;

    // WEEKLY SPENDING LIMIT: how much you can still spend each remaining week and
    // finish the cycle with at least your savings target left.
    if (userConfig.savingsTarget > 0) {
      const allow = computeWeeklyAllowance({
        income: displayIncome,
        totalExpense: summary.totalExpense,
        savingsTarget: userConfig.savingsTarget,
        startDate: dateCtx.startDate,
        endDate: dateCtx.endDate,
        today: dateCtx.today,
      });

      if (allow.cycleEnded) {
        // Cycle is over — nothing left to budget.
      } else if (allow.overBudget) {
        text += `⛔ Already ${formatCurrency(-allow.remainingAllowance)} past your ${formatCurrency(userConfig.savingsTarget)} target — no room left to spend.\n`;
      } else {
        text += `🎚️ To keep ${formatCurrency(userConfig.savingsTarget)}: spend ≤ ${formatCurrency(allow.weeklyAllowance)}/week (${allow.remainingDays} days left)\n`;
        text += weeklyRate <= allow.weeklyAllowance
          ? `✅ Your ${formatCurrency(weeklyRate)}/week pace is within budget\n`
          : `⚠️ Slow down — your ${formatCurrency(weeklyRate)}/week pace is over by ${formatCurrency(weeklyRate - allow.weeklyAllowance)}/week\n`;
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
 * Renders a /query response. Total is summed across non-excluded Expense rows
 * only — Income and excluded rows are shown but don't add to the total.
 */
export function formatQueryResult(matches, keyword, startDate, endDate) {
  let text = `🔎 "${keyword}" · ${startDate} → ${endDate}\n`;
  if (matches.length === 0) {
    text += `No matches.`;
    return text;
  }
  const total = matches
    .filter(m => m.type === 'Expense' && !m.excluded)
    .reduce((s, m) => s + m.amount, 0);
  text += `Matches: ${matches.length} entries · Total spent: ${formatCurrency(total)}\n`;
  text += `Recent:\n`;
  const top = matches.slice(0, 5);
  for (const m of top) {
    const tag = m.excluded ? ' (excluded)' : m.type !== 'Expense' ? ` (${m.type})` : '';
    text += `  ${m.date.slice(5)} ${m.name} · ${formatCurrency(m.amount)} · ${m.payment}${tag}\n`;
  }
  if (matches.length > 5) text += `  ... +${matches.length - 5} more\n`;
  return text;
}

/**
 * Formats error messages cleanly.
 */
export function formatError(message) {
  return `❌ ${message}`;
}
