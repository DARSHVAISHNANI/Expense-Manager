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
 * Substring-match `keyword` against Name + " " + Notes of each page (case-insensitive).
 * Matches all transaction types (Expense/Income/Transfer) so queries like "salary"
 * find income too. Results sorted by date descending.
 */
export function matchTransactions(pages, keyword) {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return [];
  const matched = [];
  for (const p of pages) {
    const name = readText(p.properties?.Name);
    const notes = readText(p.properties?.Notes);
    const haystack = `${name} ${notes}`.toLowerCase();
    if (!haystack.includes(kw)) continue;
    matched.push({
      name,
      notes,
      amount: p.properties?.Amount?.number || 0,
      date: p.properties?.Date?.date?.start || '',
      type: p.properties?.Type?.select?.name || '',
      payment: p.properties?.Payment?.select?.name || '',
      excluded: p.properties?.Exclude?.checkbox === true,
    });
  }
  matched.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return matched;
}

/**
 * LLM-backed: turns "total mcd this month" into {keyword, startDate, endDate}.
 * Missing fields fall back to `defaults`.
 */
export async function parseQuery(text, today, defaults = {}) {
  const systemPrompt = `You convert a user's spending question into a JSON filter. Return ONLY this JSON object — no markdown, no commentary:
{"keyword": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}

- keyword: the merchant/category word to search for in transaction Name + Notes. Lowercase. Empty string if user asks generally.
- startDate, endDate: inclusive window. Resolve relative phrases against today=${today}:
  - "this month" → first day of today's month → last day of today's month
  - "last week" → most recent fully-completed Monday → Sunday
  - "today" → ${today} → ${today}
  - "yesterday" → today-1 → today-1
  - month names like "June" → first → last day of that month in the current year
  - if no timeframe is mentioned, use start=${defaults.startDate || today} end=${defaults.endDate || today}`;

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
