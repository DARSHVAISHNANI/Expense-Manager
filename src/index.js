import 'dotenv/config';
import express from 'express';
import { startBot } from './bot.js';

const app = express();
// Render automatically assigns a PORT environment variable
const port = process.env.PORT || 3000;

// A simple web route we can "ping" to keep the bot awake
app.get('/', (req, res) => {
  res.send('🤖 Finance Bot is awake and running!');
});

app.listen(port, async () => {
  console.log(`🌐 Dummy Web server listening on port ${port}`);
  console.log('🤖 Finance Bot starting...');
  try {
    await startBot();
  } catch (e) {
    console.error('Failed to start bot:', e.message);
    process.exit(1);
  }
});