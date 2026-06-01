import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import 'dotenv/config';

import { parseTransactionText } from './parser.js';
import { transcribeAudio } from './transcriber.js';
import { insertEntry, getDateRangeSummary } from './notion.js';
import { formatAddedEntry, formatSummaryOnly, formatError } from './formatter.js';
import { backSolveInit } from './calculations.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUserId = parseInt(process.env.ALLOWED_TELEGRAM_USER_ID, 10);

// Today's date in IST as YYYY-MM-DD — used for projections and as the live "now".
const getISTToday = () => {
  const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const year = nowIST.getFullYear();
  const month = String(nowIST.getMonth() + 1).padStart(2, '0');
  const day = String(nowIST.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Initialize bot in polling mode
const bot = new TelegramBot(token, { polling: true });

// --- IN-MEMORY STORAGE FOR GOALS ---
let userConfig = {
  startDate: '',  // NEW: Stores the custom start date
  endDate: '',    // NEW: Stores the custom end date
  income: 0,
  rentLimit: 0,
  electricityLimit: 0,
  groceriesLimit: 0,
  foodLimit: 0,
  billsLimit: 0,
  travelLimit: 0,
  hdfcInit: 0,
  sbiInit: 0,
  cashInit: 0,
  savingsTarget: 0,
  // Temp holders for the CURRENT balances the user types during /setup.
  // At setup completion these get back-solved into the *Init opening balances above.
  hdfcCurrent: 0,
  sbiCurrent: 0,
  cashCurrent: 0
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
    const welcomeText = `👋 Welcome to your Finance Tracker!\n\nJust type or send a voice note like:\n"spent 600 on travel to Ahmedabad, parent's paid"\n\nCommands:\n/setup - Set your monthly cycle and targets\n/summary - View this cycle's stats\n/help - View formatting examples`;
    bot.sendMessage(msg.chat.id, welcomeText);
  });

  // --- COMMAND: /help ---
  bot.onText(/^\/help$/, (msg) => {
    if (!isAllowed(msg)) return;
    const helpText = `💡 **Examples to try:**\n\n- "600 travel hdfc"\n- "spent 1200 on groceries cash"\n- "received 5000 salary"\n- "120 maggi food"\n- "transfer 500 from hdfc to cash"\n\nOr simply send a voice note saying the same!`;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  // --- COMMAND: /setup ---
  bot.onText(/^\/setup$/, (msg) => {
    if (!isAllowed(msg)) return;
    setupStep = 1; // Start the wizard
    bot.sendMessage(msg.chat.id, "🛠️ Let's set up your custom billing cycle and Goals!\n\n**Question 1:** What is the START DATE for your cycle? (Format: YYYY-MM-DD, e.g., 2026-04-24)");
  });

  // --- COMMAND: /summary ---
  bot.onText(/^\/summary(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAllowed(msg)) return;

    try {
      bot.sendChatAction(msg.chat.id, 'typing');

      let startDate, endDate, displayTitle;
      const args = match[1]?.trim();

      // 1. IF USER PROVIDED DATES MANUALLY (e.g. "/summary 2026-04-15 2026-05-15")
      if (args) {
        const dates = args.split(' ');
        if (dates.length !== 2) {
          return bot.sendMessage(msg.chat.id, "❌ Format: /summary YYYY-MM-DD YYYY-MM-DD");
        }
        startDate = dates[0];
        endDate = dates[1];
        displayTitle = `${startDate} to ${endDate} Summary`;
      }
      // 2. OTHERWISE USE THE SAVED /setup CYCLE DATES
      else if (userConfig.startDate && userConfig.endDate) {
        startDate = userConfig.startDate;
        endDate = userConfig.endDate;
        displayTitle = `${startDate} to ${endDate} Summary`;
      }
      // 3. NO CYCLE ACTIVE: ask the user to run /setup (no calendar-month guesswork)
      else {
        return bot.sendMessage(msg.chat.id, "📅 No active cycle yet. Please run /setup first to set your billing cycle and balances.");
      }

      // Fetch the data and format it!
      const summary = await getDateRangeSummary(startDate, endDate);
      const dateCtx = { startDate, endDate, today: getISTToday() };
      bot.sendMessage(msg.chat.id, formatSummaryOnly(summary, displayTitle, userConfig, dateCtx));

    } catch (error) {
      bot.sendMessage(msg.chat.id, formatError('Failed to fetch summary. Check your dates!'));
    }
  });

  // --- HANDLE ALL OTHER MESSAGES (Text & Voice) ---
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (!isAllowed(msg)) return;
    if (!msg.text && !msg.voice) return;

    // --- SETUP WIZARD LOGIC ---
    if (setupStep > 0 && msg.text) {
      const textVal = msg.text.trim();

      // NEW: Special date validation for Questions 1 and 2
      if (setupStep === 1 || setupStep === 2) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(textVal)) {
          return bot.sendMessage(msg.chat.id, "❌ Please enter a valid date exactly in YYYY-MM-DD format.");
        }

        if (setupStep === 1) {
          userConfig.startDate = textVal;
          setupStep = 2;
          return bot.sendMessage(msg.chat.id, "✅ **Question 2:** What is the END DATE for your cycle? (Format: YYYY-MM-DD)");
        } else if (setupStep === 2) {
          userConfig.endDate = textVal;
          setupStep = 3;
          return bot.sendMessage(msg.chat.id, "✅ **Question 3:** What is your expected total Monthly Income? (Just type a number)");
        }
      }
      // Normal number validation for the rest of the questions
      else {
        const value = parseInt(textVal.replace(/,/g, ''), 10);
        if (isNaN(value)) {
          return bot.sendMessage(msg.chat.id, "❌ Please enter a valid number without text.");
        }

        switch (setupStep) {
          case 3:
            userConfig.income = value;
            setupStep = 4;
            return bot.sendMessage(msg.chat.id, "✅ **Question 4:** What is your Rent limit?");
          case 4:
            userConfig.rentLimit = value;
            setupStep = 5;
            return bot.sendMessage(msg.chat.id, "✅ **Question 5:** What is your Electricity limit?");
          case 5:
            userConfig.electricityLimit = value;
            setupStep = 6;
            return bot.sendMessage(msg.chat.id, "✅ **Question 6:** What is your Groceries limit?");
          case 6:
            userConfig.groceriesLimit = value;
            setupStep = 7;
            return bot.sendMessage(msg.chat.id, "✅ **Question 7:** What is your Food (Eating out) limit?");
          case 7:
            userConfig.foodLimit = value;
            setupStep = 8;
            return bot.sendMessage(msg.chat.id, "✅ **Question 8:** What is your limit for Other Bills?");
          case 8:
            userConfig.billsLimit = value;
            setupStep = 9;
            return bot.sendMessage(msg.chat.id, "✅ **Question 9:** What is your Travel limit?");
          case 9:
            userConfig.travelLimit = value;
            setupStep = 10;
            return bot.sendMessage(msg.chat.id, "✅ **Question 10:** What is your CURRENT balance in your HDFC account RIGHT NOW?");
          case 10:
            userConfig.hdfcCurrent = value;
            setupStep = 11;
            return bot.sendMessage(msg.chat.id, "✅ **Question 11:** What is your CURRENT balance in your SBI account RIGHT NOW?");
          case 11:
            userConfig.sbiCurrent = value;
            setupStep = 12;
            return bot.sendMessage(msg.chat.id, "✅ **Question 12:** What is your CURRENT balance in Cash RIGHT NOW?");
          case 12:
            userConfig.cashCurrent = value;
            setupStep = 13;
            return bot.sendMessage(msg.chat.id, "✅ **Final Question:** What is your ultimate Savings Target for this cycle?");
          case 13: {
            userConfig.savingsTarget = value;
            setupStep = 0; // Exit setup mode

            // Back-solve opening balances from the CURRENT balances the user typed, so the
            // Live Balance immediately reads what they entered and never double-counts the
            // transactions already in this cycle. One Notion query covers all three accounts.
            try {
              const setupSummary = await getDateRangeSummary(userConfig.startDate, userConfig.endDate);
              const deltas = setupSummary.accountBalances || {};
              userConfig.hdfcInit = backSolveInit(userConfig.hdfcCurrent, deltas['HDFC'] || 0);
              userConfig.sbiInit = backSolveInit(userConfig.sbiCurrent, deltas['SBI'] || 0);
              userConfig.cashInit = backSolveInit(userConfig.cashCurrent, deltas['Cash'] || 0);
              return bot.sendMessage(msg.chat.id, `🎉 Setup Complete! Your cycle is set from ${userConfig.startDate} to ${userConfig.endDate}. Live balances are reconciled with your existing transactions. Type /summary to see your dashboard.`);
            } catch (error) {
              // Couldn't reach Notion to reconcile — store typed values as-is and warn.
              userConfig.hdfcInit = userConfig.hdfcCurrent;
              userConfig.sbiInit = userConfig.sbiCurrent;
              userConfig.cashInit = userConfig.cashCurrent;
              return bot.sendMessage(msg.chat.id, `🎉 Setup saved (cycle ${userConfig.startDate} to ${userConfig.endDate}), but I couldn't reach Notion to reconcile your live balances against existing transactions. Please re-run /setup once your connection is back so the numbers stay accurate.`);
            }
          }
        }
      }
    } // End of setup wizard

    // --- NORMAL EXPENSE TRACKING LOGIC ---
    try {
      bot.sendChatAction(msg.chat.id, 'typing');
      let textToParse = msg.text;

      // If it's a voice note, download and transcribe it first
      if (msg.voice) {
        const fileLink = await bot.getFileLink(msg.voice.file_id);
        const response = await fetch(fileLink);
        const audioBuffer = await response.arrayBuffer();
        textToParse = await transcribeAudio(Buffer.from(audioBuffer));
        console.log(`🎙️ Transcribed: "${textToParse}"`);
      }

      // 4. Parse the text using Groq LLaMA 3
      const parsedData = await parseTransactionText(textToParse);

      // 5. Insert into Notion
      await insertEntry(parsedData);

      // 6. Wait 2500ms to give Notion time to index the new entry
      await new Promise(resolve => setTimeout(resolve, 2500));

      // 7. No active /setup cycle: the entry is saved, but we can't show a cycle
      //    dashboard without dates. Confirm the save and nudge them to run /setup.
      if (!userConfig.startDate || !userConfig.endDate) {
        return bot.sendMessage(msg.chat.id, `✅ Saved: ${parsedData.name} (₹${parsedData.amount.toLocaleString('en-IN')}).\n\n📅 Run /setup to set your billing cycle and see your full dashboard.`);
      }

      // 8. Use the saved /setup cycle dates.
      const startDate = userConfig.startDate;
      const endDate = userConfig.endDate;
      const displayTitle = `${startDate} to ${endDate} Summary`;

      // 9. Fetch the newly updated summary data
      const summary = await getDateRangeSummary(startDate, endDate);

      // 10. Send the success message!
      const dateCtx = { startDate, endDate, today: getISTToday() };
      bot.sendMessage(msg.chat.id, formatAddedEntry(parsedData, summary, displayTitle, userConfig, dateCtx));

    } catch (error) {
      bot.sendMessage(msg.chat.id, formatError(error.message));
    }
  });
}