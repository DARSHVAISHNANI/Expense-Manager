import Groq from 'groq-sdk';
import 'dotenv/config';

// Initialize the Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function parseTransactionText(userInput) {
  // 1. Get the current time exactly in India
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);

  // 2. Format it strictly as YYYY-MM-DD for Notion
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  const todayDate = `${year}-${month}-${day}`;

  const systemPrompt = ` You are a finance entry parser. The user will describe a financial transaction in casual language.  Extract the fields and return ONLY a valid JSON object. No explanation, no markdown, just raw JSON. 

Fields to extract:
- name: short description of transaction (string)
- type: MUST be "Income", "Expense", or "Transfer"
- amount: number only, no currency symbol (number)
- date: ${todayDate} unless user specifies otherwise. MUST strictly be YYYY-MM-DD format.
- category: one of [Transportation, Groceries, Food, Electricity, Bills, Rent, Shopping, Health, Entertainment, Salary, Transfer, Other]
- payment: the SOURCE account. MUST EXACTLY MATCH one of ["Parent's Paid", "HDFC", "SBI", "Cash"]
- destination: ONLY used if type is "Transfer". The RECEIVING account. MUST EXACTLY MATCH one of ["HDFC", "SBI", "Cash"]. Otherwise empty string "".
- notes: any extra info not captured above (string, can be empty)
- exclude: a boolean (true/false). Set to true ONLY if the user explicitly asks to ignore, exclude, or not count this transaction towards their total spending. Otherwise false.

If any field cannot be determined, use these defaults:
- type: "Expense"
- category: "Other"
- payment: "HDFC"
- destination: ""
- notes: ""
- exclude: false
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const responseText = chatCompletion.choices[0]?.message?.content || '{}';
    return JSON.parse(responseText);

  } catch (error) {
    console.error('❌ Error parsing text with Groq:', error);
    throw new Error("❌ Couldn't parse that. Try: '600 food HDFC' or 'transfer 5000 from HDFC to SBI'");
  }
}