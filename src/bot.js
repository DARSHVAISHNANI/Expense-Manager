import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import 'dotenv/config';

import { parseTransactionText } from './parser.js';
import { transcribeAudio } from './transcriber.js';
import { insertEntry, getMonthlySummary } from './notion.js';
import { formatAddedEntry, formatSummaryOnly, formatError } from './formatter.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUserId = parseInt(process.env.ALLOWED_TELEGRAM_USER_ID, 10);

// Initialize bot in polling mode
const bot = new TelegramBot(token, { polling: true });

// --- IN-MEMORY STORAGE FOR GOALS ---
// Replace your userConfig at the top of the file:
let userConfig = {
  income: 0,
  rentLimit: 0,
  electricityLimit: 0,
  groceriesLimit: 0,
  foodLimit: 0,
  billsLimit: 0,
  travelLimit: 0,
  hdfcInit: 0,    // NEW: Opening Balance
  sbiInit: 0,     // NEW: Opening Balance
  savingsTarget: 0,
    cashInit: 0,
};

// Tracks where the user is in the setup process (0 = not in setup)
let setupStep = 0;

// Security Middleware: Ignore messages from unauthorized users
const isAllowed = (msg) => {
  if (msg.from.id !== allowedUserId) {
    console.warn(`⚠️ Unauthorized access attempt from User ID: ${msg.from.id}`);
    return false;
  }
  return true;
};

// Start the bot exported function
export function startBot() {
  console.log('🟢 Bot is actively listening for messages...');

  // --- COMMAND: /start ---
  bot.onText(/^\/start$/, (msg) => {
    if (!isAllowed(msg)) return;
    const welcomeText = `👋 Welcome to your Finance Tracker!\n\nJust type or send a voice note like:\n"spent 600 on travel to Ahmedabad, parent's paid"\n\nCommands:\n/setup - Set your monthly targets\n/summary - View this month's stats\n/help - View formatting examples`;
    bot.sendMessage(msg.chat.id, welcomeText);
  });

  // --- COMMAND: /help ---
  bot.onText(/^\/help$/, (msg) => {
    if (!isAllowed(msg)) return;
    const helpText = `💡 **Examples to try:**\n\n- "600 travel hdfc upi"\n- "spent 1200 on groceries cash"\n- "received 5000 salary"\n- "120 maggi food"\n\nOr simply send a voice note saying the same!`;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  // --- COMMAND: /setup ---
  bot.onText(/^\/setup$/, (msg) => {
    if (!isAllowed(msg)) return;
    setupStep = 1; // Start the wizard
    bot.sendMessage(msg.chat.id, "🛠️ Let's set up your Goals for this month!\n\n**Question 1:** What is your expected total Monthly Income? (Just type a number, e.g., 50000)");
  });

  // --- COMMAND: /summary ---
  bot.onText(/^\/summary$/, async (msg) => {
    if (!isAllowed(msg)) return;
    try {
      bot.sendChatAction(msg.chat.id, 'typing');

      // Get current dynamic month and year
      const now = new Date();
      const summary = await getMonthlySummary(now.getFullYear(), now.getMonth() + 1);

      bot.sendMessage(msg.chat.id, formatSummaryOnly(summary, now.getMonth() + 1, now.getFullYear(), userConfig));
    } catch (error) {
      bot.sendMessage(msg.chat.id, formatError('Failed to fetch summary.'));
    }
  });

  // --- HANDLE ALL OTHER MESSAGES (Text & Voice) ---
  bot.on('message', async (msg) => {
    // Ignore commands, they are handled above
    if (msg.text && msg.text.startsWith('/')) return;
    if (!isAllowed(msg)) return;

    // We only care about text or voice
    if (!msg.text && !msg.voice) return;

    // 2. Replace the SETUP WIZARD LOGIC inside bot.on('message') with this:
    if (setupStep > 0 && msg.text) {
      const value = parseInt(msg.text.replace(/,/g, ''), 10);

      if (isNaN(value)) {
        return bot.sendMessage(msg.chat.id, "❌ Please enter a valid number without text.");
      }

      // Replace the entire switch statement inside the bot.on('message') block:
      switch (setupStep) {
        case 1:
          userConfig.income = value;
          setupStep = 2;
          return bot.sendMessage(msg.chat.id, "✅ **Question 2:** What is your Rent limit?");
        case 2:
          userConfig.rentLimit = value;
          setupStep = 3;
          return bot.sendMessage(msg.chat.id, "✅ **Question 3:** What is your Electricity limit?");
        case 3:
          userConfig.electricityLimit = value;
          setupStep = 4;
          return bot.sendMessage(msg.chat.id, "✅ **Question 4:** What is your Groceries limit?");
        case 4:
          userConfig.groceriesLimit = value;
          setupStep = 5;
          return bot.sendMessage(msg.chat.id, "✅ **Question 5:** What is your Food (Eating out) limit?");
        case 5:
          userConfig.foodLimit = value;
          setupStep = 6;
          return bot.sendMessage(msg.chat.id, "✅ **Question 6:** What is your limit for Other Bills?");
        case 6:
          userConfig.billsLimit = value;
          setupStep = 7;
          return bot.sendMessage(msg.chat.id, "✅ **Question 7:** What is your Travel limit?");
        case 7:
          userConfig.travelLimit = value;
          setupStep = 8;
          return bot.sendMessage(msg.chat.id, "✅ **Question 8:** What is your CURRENT balance in your HDFC account?");
        case 8:
          userConfig.hdfcInit = value;
          setupStep = 9;
          return bot.sendMessage(msg.chat.id, "✅ **Question 9:** What is your CURRENT balance in your SBI account?");
        case 9:
          userConfig.sbiInit = value;
          setupStep = 10;
          return bot.sendMessage(msg.chat.id, "✅ **Question 10:** What is your CURRENT balance in Cash?");
        case 10:
          userConfig.cashInit = value;
          setupStep = 11;
          return bot.sendMessage(msg.chat.id, "✅ **Final Question:** What is your ultimate Savings Target for this month?");
        case 11:
          userConfig.savingsTarget = value;
          setupStep = 0; // Exit setup mode
          return bot.sendMessage(msg.chat.id, `🎉 Setup Complete! Type /summary to see your detailed budget dashboard.`);
      }

    // --- NORMAL EXPENSE TRACKING LOGIC ---
    try {
      bot.sendChatAction(msg.chat.id, 'typing');
      let textToParse = msg.text;

      // If it's a voice note, download and transcribe it first
      if (msg.voice) {
        // 1. Get file link from Telegram
        const fileLink = await bot.getFileLink(msg.voice.file_id);

        // 2. Download the audio file into a Buffer
        const response = await fetch(fileLink);
        const audioBuffer = await response.arrayBuffer();

        // 3. Transcribe with Groq Whisper
        textToParse = await transcribeAudio(Buffer.from(audioBuffer));
        console.log(`🎙️ Transcribed: "${textToParse}"`);
      }

      // 4. Parse the text using Groq LLaMA 3
      const parsedData = await parseTransactionText(textToParse);

      // 5. Insert into Notion
      await insertEntry(parsedData);

      // 6. Wait 300ms to avoid Notion rate limits
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get current dynamic month based on the parsed entry
      const now = new Date(parsedData.date);
      const summary = await getMonthlySummary(now.getFullYear(), now.getMonth() + 1);

      bot.sendMessage(msg.chat.id, formatAddedEntry(parsedData, summary, userConfig));

    } catch (error) {
      bot.sendMessage(msg.chat.id, formatError(error.message));
    }
  });
}