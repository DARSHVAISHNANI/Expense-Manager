import Groq from 'groq-sdk';
import 'dotenv/config';

// Initialize the Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Parses unstructured text into a structured JSON financial entry.
 * @param {string} userInput - The raw message from the user.
 * @returns {Object} - The parsed JSON object.
 */
export async function parseTransactionText(userInput) {
  // Grabs the live current date in India (must be inside the function to stay updated)
  const todayDate = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const systemPrompt = `
You are a finance entry parser. The user will describe a financial transaction in casual language. 
Extract the fields and return ONLY a valid JSON object. No explanation, no markdown, just raw JSON.

Fields to extract:
- name: short description of transaction (string)
- type: MUST be "Income", "Expense", or "Transfer"
- amount: number only, no currency symbol (number)
- date: ${todayDate} unless user specifies otherwise
- category: one of [Transportation, Groceries, Food, Electricity, Bills, Rent, Shopping, Health, Entertainment, Salary, Transfer, Other]
- payment: the SOURCE account. MUST EXACTLY MATCH one of ["Parent's Paid", "HDFC", "SBI", "Cash"]
- destination: ONLY used if type is "Transfer". The RECEIVING account. MUST EXACTLY MATCH one of ["HDFC", "SBI", "Cash"]. Otherwise empty string "".
- notes: any extra info not captured above (string, can be empty)

If any field cannot be determined, use these defaults:
- type: "Expense"
- category: "Other"
- payment: "HDFC"  
- destination: ""
- notes: ""
  `;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0, // 0 ensures deterministic, highly consistent output
      max_tokens: 300,
      // We enforce JSON mode so the AI doesn't reply with conversational text
      response_format: { type: "json_object" }
    });

    // Extract the text response
    const responseText = chatCompletion.choices[0]?.message?.content || '{}';

    // Convert the string into a real JavaScript object
    const parsedData = JSON.parse(responseText);

    return parsedData;

  } catch (error) {
    console.error('❌ Error parsing text with Groq:', error);
    throw new Error("❌ Couldn't parse that. Try: '600 food HDFC' or 'transfer 5000 from HDFC to SBI'");
  }
}