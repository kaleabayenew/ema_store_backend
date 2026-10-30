const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const backendUrl = process.env.BACKEND_URL || 'https://ema-store-backend.onrender.com';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Ema Store Bot started!');

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;

  bot.sendMessage(chatId, `
👋 *Welcome to Ema Store Bot!*

This bot will send you verification codes when you register or reset your password.

To link your phone number, please use the following command:

/link <your_phone_number>

Example: /link +251912345678

Make sure to include your country code (+251 for Ethiopia).
  `, { parse_mode: 'Markdown' });
});

// Handle /link command
bot.onText(/\/link (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const phone = match[1];
  const username = msg.from.username;

  try {
    // Call backend API to link the phone number
    const response = await fetch(`${backendUrl}/api/v1/telegram/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: phone,
        chat_id: chatId,
        username: username,
      }),
    });

    const data = await response.json();

    if (data.success) {
      bot.sendMessage(chatId, `
✅ *Phone Number Linked Successfully!*

Your phone number ${phone} is now linked to this Telegram bot.

You will receive verification codes here when you register or reset your password in the Ema Store app.
      `, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ Failed to link phone number: ${data.message}`);
    }
  } catch (error) {
    console.error('Link error:', error);
    bot.sendMessage(chatId, '❌ Failed to link phone number. Please try again later.');
  }
});

// Handle unknown commands
bot.on('message', (msg) => {
  if (!msg.text?.startsWith('/')) {
    bot.sendMessage(msg.chat.id, `
Please use the commands:
- /start - Show welcome message
- /link <phone> - Link your phone number
    `);
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error(`[Bot] Polling error: ${error.code} - ${error.message}`);
});
