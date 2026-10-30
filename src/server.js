const app = require('./app');
const { port } = require('./core/config');
const { checkDatabaseConnection, pool } = require('./core/config/database');
const TelegramBot = require('node-telegram-bot-api');

async function startServer() {
	let databaseConnected = false;

	try {
		await checkDatabaseConnection();
		databaseConnected = true;
	} catch (error) {
		const code = typeof error.code === 'string' ? error.code : 'CONNECTION_FAILED';
		console.error(`Database: NOT CONNECTED (${code})`);
	}

	// Start Telegram Bot if token is configured
	let bot = null;
	const botToken = process.env.TELEGRAM_BOT_TOKEN;
	if (botToken) {
		try {
			bot = new TelegramBot(botToken, { polling: true });
			console.log('🤖 Telegram Bot: Starting...');

			// Handle /start command
			bot.onText(/\/start/, (msg) => {
				const chatId = msg.chat.id;
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
					const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
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
					console.error('[Bot] Link error:', error);
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

			// Handle bot errors
			bot.on('polling_error', (error) => {
				// Ignore conflict errors from previous instances
				if (error.code === 'ETELEGRAM' && error.message.includes('Conflict')) {
					console.log('[Bot] Conflict detected - another instance may be running');
				} else {
					console.error(`[Bot] Polling error: ${error.code} - ${error.message}`);
				}
			});

			console.log('🤖 Telegram Bot: Started successfully');
		} catch (error) {
			console.error('🤖 Telegram Bot: Failed to start', error.message);
		}
	} else {
		console.log('🤖 Telegram Bot: Skipped (TELEGRAM_BOT_TOKEN not set)');
	}

	const server = app.listen(port, () => {
		const baseUrl = `http://localhost:${port}`;
		console.log('\nEma Store Backend');
		console.log(`Database: ${databaseConnected ? 'CONNECTED' : 'NOT CONNECTED'}`);
		console.log(`API:      ${baseUrl}`);
		console.log(`Health:   ${baseUrl}/health`);
		console.log(`Bot:      ${bot ? 'RUNNING' : 'DISABLED'}\n`);
	});

	server.on('error', (error) => {
		const code = typeof error.code === 'string' ? error.code : 'LISTEN_FAILED';
		console.error(`Server: FAILED TO START (${code})`);
		process.exitCode = 1;
	});

	const shutdown = (signal) => {
		if (bot) {
			bot.stopPolling();
			console.log('🤖 Telegram Bot: Stopped');
		}
		server.close(() => {
			pool.end().finally(() => {
				if (signal === 'SIGUSR2') {
					process.kill(process.pid, 'SIGUSR2');
				}
			});
		});
	};

	process.once('SIGINT', () => shutdown('SIGINT'));
	process.once('SIGTERM', () => shutdown('SIGTERM'));
	process.once('SIGUSR2', () => shutdown('SIGUSR2'));
}

startServer().catch((error) => {
	console.error('[server] failed to start');
	process.exitCode = 1;
});
