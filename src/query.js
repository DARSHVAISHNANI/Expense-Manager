import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const readText = (prop) => {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  return '';
};

/**
 * Filter pages by an optional `keyword` (substring match against Name+Notes,
 * case-insensitive). Empty keyword returns ALL pages in the window — used when
 * the user asks an open question like "what did I spend on Monday".
 *
 * Matches all transaction types so "salary" queries find income too. Sorted by
 * date desc. Each match carries name, notes, amount, date, type, payment,
 * category, excluded.
 */
export function matchTransactions(pages, keyword) {
  const kw = (keyword || '').trim().toLowerCase();
  const matched = [];
  for (const p of pages) {
    const name = readText(p.properties?.Name);
    const notes = readText(p.properties?.Notes);
    if (kw) {
      const haystack = `${name} ${notes}`.toLowerCase();
      if (!haystack.includes(kw)) continue;
    }
    matched.push({
      name,
      notes,
      amount: p.properties?.Amount?.number || 0,
      date: p.properties?.Date?.date?.start || '',
      type: p.properties?.Type?.select?.name || '',
      payment: p.properties?.Payment?.select?.name || '',
      category: p.properties?.Category?.select?.name || '',
      excluded: p.properties?.Exclude?.checkbox === true,
    });
  }
  matched.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return matched;
}

/**
 * LLM-backed: turns "what did I spend on Monday" / "total mcd this month" /
 * "swiggy last week" into a structured filter.
 *
 * Returns {keyword, startDate, endDate}. keyword may be EMPTY when the user
 * asks generally ("what did I spend on Monday") — that's the signal to list
 * every transaction in the window.
 */
export async function parseQuery(text, today, defaults = {}) {
  const systemPrompt = `You convert a user's spending question into a JSON filter. Return ONLY this JSON object — no markdown, no commentary:
{"keyword": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}

- keyword: the merchant, category, or specific word to substring-match in Name + Notes. Lowercase. Use an EMPTY STRING when the user asks generally ("what did I spend on Monday", "list all expenses last week", "show transactions in June"). Only set keyword when the user names a specific thing (mcd, swiggy, salary, pizza, groceries).
- startDate, endDate: inclusive window. Resolve relative phrases against today=${today}:
  - "this month" → first day of today's month → last day of today's month
  - "last month" → first → last day of the previous month
  - "last week" → most recent fully-completed Monday → Sunday relative to today
  - "this week" → most recent Monday → today
  - "today" → ${today} → ${today}
  - "yesterday" → today-1 → today-1
  - Specific weekday names like "Monday", "on Tuesday" → the date of the most recent past occurrence of that weekday (single day, start == end)
  - Month names like "June" → first → last day of that month in the current year
  - If no timeframe is mentioned, use start=${defaults.startDate || today} end=${defaults.endDate || today}`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
  });
  const responseText = chatCompletion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(responseText);
  return {
    keyword: (parsed.keyword || '').trim(),
    startDate: parsed.startDate || defaults.startDate || today,
    endDate: parsed.endDate || defaults.endDate || today,
  };
}
