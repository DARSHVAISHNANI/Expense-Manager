import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function parseTransactionText(userInput) {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);

  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  const todayDate = `${year}-${month}-${day}`;

  const systemPrompt = `You are a finance entry parser. The user will describe ONE OR MORE financial transactions in casual language. Return ONLY a valid JSON object of the form: {"entries": [ {...}, {...} ]}. No explanation, no markdown.

Split the user input into separate entries whenever they describe distinct transactions. Common separators include "and", commas, "then", new lines, or any other natural break. If only one transaction is described, return a single-element array. Never return an empty array.

Each entry has these fields:
- name: short description of transaction (string)
- type: MUST be "Income", "Expense", or "Transfer"
- amount: number only, no currency symbol (number)
- date: ${todayDate} unless user specifies otherwise. MUST strictly be YYYY-MM-DD format.
- category: one of [Transportation, Groceries, Food, Electricity, Bills, Rent, Shopping, Health, Entertainment, Salary, Transfer, Other]
- payment: the SOURCE account. MUST EXACTLY MATCH one of ["Parent's Paid", "HDFC", "SBI", "Cash"]
- destination: ONLY used if type is "Transfer". The RECEIVING account. MUST EXACTLY MATCH one of ["HDFC", "SBI", "Cash"]. Otherwise empty string "".
- notes: any extra info not captured above (string, can be empty)
- exclude: a boolean (true/false). Set to true ONLY if the user explicitly asks to ignore, exclude, or not count this transaction towards their total spending. Otherwise false.

If any field cannot be determined for an entry, use these defaults:
- type: "Expense"
- category: "Other"
- payment: "HDFC"
- destination: ""
- notes: ""
- exclude: false

Example multi-entry input: "mcd 35 cash and taco bell 45 sbi"
Example output: {"entries":[{"name":"mcd","type":"Expense","amount":35,"date":"${todayDate}","category":"Food","payment":"Cash","destination":"","notes":"","exclude":false},{"name":"taco bell","type":"Expense","amount":45,"date":"${todayDate}","category":"Food","payment":"SBI","destination":"","notes":"","exclude":false}]}`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" }
    });

    const responseText = chatCompletion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(responseText);

    // Defensive: tolerate the LLM occasionally returning a single object.
    if (!parsed.entries) {
      return { entries: [parsed] };
    }
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      throw new Error('Parser returned no entries.');
    }
    return parsed;

  } catch (error) {
    console.error('❌ Error parsing text with Groq:', error);
    throw new Error("❌ Couldn't parse that. Try: '600 food HDFC' or '35 mcd cash and 45 taco sbi'");
  }
}
