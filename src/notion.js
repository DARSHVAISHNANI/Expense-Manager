import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Single source of truth for "does this Notion row count toward spending totals?"
 * Skips non-Expense, excluded rows, rent (by default), and Config marker rows.
 */
export function isCountableExpense(page, { excludeRent = true } = {}) {
  const type = page.properties?.Type?.select?.name;
  const category = page.properties?.Category?.select?.name;
  const excluded = page.properties?.Exclude?.checkbox === true;
  if (type !== 'Expense') return false;
  if (excluded) return false;
  if (excludeRent && category === 'Rent') return false;
  return true;
}

/** A page that's our own config marker row — never count it anywhere. */
export function isConfigRow(page) {
  return page.properties?.Type?.select?.name === 'Config';
}

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

/**
 * Fetch all pages whose Date is in [startDate, endDate] inclusive.
 * Returns raw Notion pages; Config marker rows are filtered out.
 */
export async function getDateRangePages(startDate, endDate) {
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

  return results.filter(p => !isConfigRow(p));
}

export async function getDateRangeSummary(startDate, endDate) {
  try {
    const results = await getDateRangePages(startDate, endDate);

    let totalExpense = 0;
    let totalIncome = 0;
    let categoryTotals = {};
    let accountBalances = { "HDFC": 0, "SBI": 0, "Parent's Paid": 0, "Cash": 0 };

    results.forEach(page => {
      const type = page.properties.Type?.select?.name;
      const amount = page.properties.Amount?.number || 0;
      const category = page.properties.Category?.select?.name || 'Other';
      const source = page.properties.Payment?.select?.name;
      const dest = page.properties.Destination?.select?.name;
      const isExcluded = page.properties.Exclude?.checkbox === true;

      if (type === 'Expense') {
        if (source && accountBalances[source] !== undefined) {
          accountBalances[source] -= amount;
        }
        if (!isExcluded) {
          totalExpense += amount;
          categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        }
      }
      else if (type === 'Income') {
        totalIncome += amount;
        if (source && accountBalances[source] !== undefined) accountBalances[source] += amount;
      }
      else if (type === 'Transfer') {
        if (source && accountBalances[source] !== undefined) accountBalances[source] -= amount;
        if (dest && accountBalances[dest] !== undefined) accountBalances[dest] += amount;
      }
    });

    return {
      totalExpense,
      totalIncome,
      balance: totalIncome - totalExpense,
      categoryTotals,
      accountBalances
    };
  } catch (error) {
    console.error('Error fetching Notion summary:', error);
    throw new Error('Failed to fetch summary for this date range.');
  }
}

// =====================================================================
// Config persistence
// =====================================================================
// Two storage modes, auto-detected on first load:
//   mode 'page': child page "Finance Bot Config" under the expense DB's
//                parent page, JSON in a single code block.
//   mode 'row':  a single marker row inside the expense DB itself
//                (Type=Config, Exclude=true, JSON in Notes). Fallback when
//                the DB's parent is the workspace (we can't create pages there).

const CONFIG_PAGE_TITLE = 'Finance Bot Config';
let _configMode = null;       // 'page' | 'row'
let _configPageId = null;
let _configRowId = null;

async function getDatabaseParent() {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  return db.parent;
}

async function findOrCreateConfigPage(parentPageId) {
  // First scan children for an existing page with our title.
  const children = await notion.blocks.children.list({ block_id: parentPageId, page_size: 100 });
  for (const block of children.results) {
    if (block.type === 'child_page' && block.child_page?.title === CONFIG_PAGE_TITLE) {
      return block.id;
    }
  }
  const created = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: { title: [{ text: { content: CONFIG_PAGE_TITLE } }] },
    children: [{
      object: 'block',
      type: 'code',
      code: { rich_text: [{ text: { content: '{}' } }], language: 'json' },
    }],
  });
  return created.id;
}

async function findConfigRow() {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: { property: 'Type', select: { equals: 'Config' } },
    page_size: 1,
  });
  return response.results[0]?.id || null;
}

async function createConfigRow(json) {
  const today = new Date().toISOString().slice(0, 10);
  const created = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Name: { title: [{ text: { content: CONFIG_PAGE_TITLE } }] },
      Type: { select: { name: 'Config' } },
      Amount: { number: 0 },
      Date: { date: { start: today } },
      Notes: { rich_text: [{ text: { content: json } }] },
      Exclude: { checkbox: true },
    },
  });
  return created.id;
}

/**
 * Discover storage mode and load saved config. Returns null if no saved
 * config exists yet (first run). Always sets the cached mode so saveConfig
 * works without re-discovering.
 */
export async function loadConfig() {
  try {
    const parent = await getDatabaseParent();

    if (parent.type === 'page_id') {
      try {
        _configPageId = await findOrCreateConfigPage(parent.page_id);
        _configMode = 'page';
        const blocks = await notion.blocks.children.list({ block_id: _configPageId, page_size: 50 });
        const code = blocks.results.find(b => b.type === 'code');
        console.log(`✅ Config storage: child page "${CONFIG_PAGE_TITLE}"`);
        if (!code) return null;
        const json = code.code.rich_text.map(t => t.plain_text).join('');
        try { return JSON.parse(json); } catch { return null; }
      } catch (e) {
        console.warn(`Config page mode failed (${e.message}). Falling back to row mode.`);
      }
    }

    // Row mode (used when parent is workspace OR page-mode failed).
    _configMode = 'row';
    _configRowId = await findConfigRow();
    if (!_configRowId) {
      console.log('✅ Config storage: marker row in expense DB (will be created on first save)');
      return null;
    }
    const page = await notion.pages.retrieve({ page_id: _configRowId });
    const json = page.properties?.Notes?.rich_text?.map(t => t.plain_text).join('') || '';
    console.log('✅ Config storage: marker row in expense DB');
    try { return JSON.parse(json); } catch { return null; }
  } catch (e) {
    console.error('loadConfig failed:', e.message);
    return null;
  }
}

/**
 * Persist config using the discovered mode. Call loadConfig() at startup first
 * so the mode is set.
 */
export async function saveConfig(config) {
  const json = JSON.stringify(config);

  if (!_configMode) {
    await loadConfig();
    if (!_configMode) throw new Error('Config storage not initialized.');
  }

  if (_configMode === 'page' && _configPageId) {
    const blocks = await notion.blocks.children.list({ block_id: _configPageId, page_size: 50 });
    const code = blocks.results.find(b => b.type === 'code');
    if (code) {
      await notion.blocks.update({
        block_id: code.id,
        code: { rich_text: [{ text: { content: json } }], language: 'json' },
      });
    } else {
      await notion.blocks.children.append({
        block_id: _configPageId,
        children: [{ object: 'block', type: 'code', code: { rich_text: [{ text: { content: json } }], language: 'json' } }],
      });
    }
    return;
  }

  if (_configMode === 'row') {
    if (!_configRowId) {
      _configRowId = await createConfigRow(json);
      return;
    }
    await notion.pages.update({
      page_id: _configRowId,
      properties: { Notes: { rich_text: [{ text: { content: json } }] } },
    });
    return;
  }

  throw new Error('Config storage not initialized.');
}