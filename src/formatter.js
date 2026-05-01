import 'dotenv/config';

// Helper to format numbers cleanly (e.g., ₹10,000)
const formatCurrency = (amount) => {
  return `₹${amount.toLocaleString('en-IN')}`;
};

/**
 * Formats the success message when a new entry is added.
 */
export function formatAddedEntry(parsedData, summary, displayTitle, userConfig = {}) {
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

  // FIX: Pass the displayTitle directly to formatSummaryOnly instead of month/year
  text += `\n${formatSummaryOnly(summary, displayTitle, userConfig)}`;

  return text;
}

/**
 * Formats the message for the /summary command.
 */
export function formatSummaryOnly(summary, title, userConfig = {}) {

  const displayIncome = userConfig.income > 0 ? userConfig.income : summary.totalIncome;
  const currentSavings = displayIncome - summary.totalExpense;

  // Use the custom title passed from the bot
  let text = `📊 ${title}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 Est. Income: ${formatCurrency(displayIncome)}\n`;
  text += `💸 Total Spent: ${formatCurrency(summary.totalExpense)}\n`;
  text += `📉 Current Bal: ${formatCurrency(currentSavings)}\n`;

  // 1. ALWAYS SHOW LIVE BALANCES (Opening Balance + Notion Transactions)
  const hdfcLive = (userConfig.hdfcInit || 0) + (summary.accountBalances?.['HDFC'] || 0);
  const sbiLive = (userConfig.sbiInit || 0) + (summary.accountBalances?.['SBI'] || 0);
  const cashLive = (userConfig.cashInit || 0) + (summary.accountBalances?.['Cash'] || 0);

  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `🏦 Live Balances:\n`;
  text += `💳 HDFC: ${formatCurrency(hdfcLive)}\n`;
  text += `🏛️ SBI: ${formatCurrency(sbiLive)}\n`;
  text += `💵 Cash: ${formatCurrency(cashLive)}\n`;

  // 2. ONLY SHOW SAVINGS GOAL IF SET
  if (userConfig.savingsTarget > 0) {
    const savingsLeftToTarget = currentSavings - userConfig.savingsTarget;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🎯 Savings Goal: ${formatCurrency(userConfig.savingsTarget)}\n`;
    text += savingsLeftToTarget >= 0
      ? `✅ On Track! (+${formatCurrency(savingsLeftToTarget)})\n`
      : `⚠️ Warning: Short by ${formatCurrency(Math.abs(savingsLeftToTarget))}\n`;
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

/**
 * Formats error messages cleanly.
 */
export function formatError(message) {
  return `❌ ${message}`;
}