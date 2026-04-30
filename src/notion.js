import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

export async function insertEntry(parsedData) {
  try {
    const properties = {
      Name: { title: [{ text: { content: parsedData.name } }] },
      Type: { select: { name: parsedData.type } },
      Amount: { number: parsedData.amount },
      Date: { date: { start: parsedData.date } },
      Category: { select: { name: parsedData.category } },
      Payment: { select: { name: parsedData.payment } },
      Notes: { rich_text: [{ text: { content: parsedData.notes || "" } }] },
      Exclude: { checkbox: parsedData.exclude || false } // <-- NEW LINE
    };

    // Only add Destination if it's a transfer so Notion doesn't throw an error
    if (parsedData.type === 'Transfer' && parsedData.destination) {
      properties.Destination = { select: { name: parsedData.destination } };
    }

    return await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties
    });
  } catch (error) {
    console.error('❌ Error inserting into Notion:', error.body || error);
    throw new Error('Failed to insert entry into Notion.');
  }
}

export async function getMonthlySummary(year, month) {
  try {
    const paddedMonth = String(month).padStart(2, '0');
    const startDate = `${year}-${paddedMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${paddedMonth}-${lastDay}`;

    let results = [];
    let hasMore = true;
    let nextCursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: nextCursor,
        filter: {
          and: [
            { property: 'Date', date: { on_or_after: startDate } },
            { property: 'Date', date: { on_or_before: endDate } }
          ]
        }
      });
      results.push(...response.results);
      hasMore = response.has_more;
      nextCursor = response.next_cursor;
    }

    let totalExpense = 0;
    let totalIncome = 0;
    let categoryTotals = {};

    // New object to track individual bank balances
    let accountBalances = { "HDFC": 0, "SBI": 0, "Parent's Paid": 0, "Cash": 0 };

    results.forEach(page => {
      const type = page.properties.Type?.select?.name;
      const amount = page.properties.Amount?.number || 0;
      const category = page.properties.Category?.select?.name || 'Other';
      const source = page.properties.Payment?.select?.name;
      const dest = page.properties.Destination?.select?.name;

      // Check if the Exclude checkbox is ticked
      const isExcluded = page.properties.Exclude?.checkbox === true;

      if (type === 'Expense') {
        // ALWAYS deduct from the live bank balance, because the money still left your account
        if (source && accountBalances[source] !== undefined) {
          accountBalances[source] -= amount;
        }

        // ONLY add to total spent and category totals if it is NOT excluded
        if (!isExcluded) {
          totalExpense += amount;
          categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        }
      }
      else if (type === 'Income') {
        totalIncome += amount;
        // Income goes INTO the source account
        if (source && accountBalances[source] !== undefined) accountBalances[source] += amount;
      }
      else if (type === 'Transfer') {
        // Minus from source, Plus to destination
        if (source && accountBalances[source] !== undefined) accountBalances[source] -= amount;
        if (dest && accountBalances[dest] !== undefined) accountBalances[dest] += amount;
      }
    });

    return {
      totalExpense,
      totalIncome,
      balance: totalIncome - totalExpense,
      categoryTotals,
      accountBalances // Return the new bank balances
    };
  } catch (error) {
    console.error('❌ Error fetching Notion summary:', error);
    throw new Error('Failed to fetch monthly summary.');
  }
}