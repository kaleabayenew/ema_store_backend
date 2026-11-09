const app = require('./app');
const { port } = require('./core/config');
const { checkDatabaseConnection, pool } = require('./core/config/database');
const TelegramBot = require('node-telegram-bot-api');

// Store pending phone number requests (chatId -> timestamp)
const pendingPhoneRequests = new Map();

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
	const botKey = process.env.TELEGRAM_BOT_API_KEY;
	if (botToken) {
		if (!botKey || botKey.length < 32) {
			// Fail closed: the backend rejects bot calls without a valid key.
			console.error('🤖 Telegram Bot: NOT STARTED (TELEGRAM_BOT_API_KEY missing or too short)');
		} else {
		try {
			// Use a unique session to avoid conflicts
			bot = new TelegramBot(botToken, {
				polling: true,
				request: {
					agentOptions: {
						keepAlive: true,
						keepAliveMsecs: 10000,
					},
				},
			});
			console.log('🤖 Telegram Bot: Starting...');

			const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
			const botHeaders = {
				'Content-Type': 'application/json',
				'x-bot-key': botKey,
			};

			// Mask a phone number for logs: +251912345678 → +251*****5678
			const maskPhone = (phone) => {
				const digits = String(phone || '').replace(/\D/g, '');
				if (digits.length < 7) return '***';
				return `+${digits.slice(0, 3)}*****${digits.slice(-4)}`;
			};

			// Normalize a Telegram contact phone to +251XXXXXXXXX
			const normalizePhone = (raw) => {
				let digits = String(raw || '').replace(/\D/g, '');
				if (digits.startsWith('251') && digits.length === 12) {
					// already international
				} else if (digits.startsWith('0') && digits.length === 10) {
					digits = `251${digits.slice(1)}`;
				} else if (!digits.startsWith('251')) {
					digits = `251${digits}`;
				}
				return `+${digits}`;
			};

			// Link the chat to a phone via the backend (bot-key authenticated)
			const linkPhone = async (chatId, phone, username) => {
				const response = await fetch(`${backendUrl}/api/v1/telegram/link`, {
					method: 'POST',
					headers: botHeaders,
					body: JSON.stringify({
						phone: phone,
						chat_id: chatId,
						username: username,
					}),
				});
				return response.json();
			};

			// Handle /start command — the ONLY way to link is the contact button
			bot.onText(/\/start/, async (msg) => {
				const chatId = msg.chat.id;

				// Already linked? Tell the user instead of showing the button.
				try {
					const response = await fetch(`${backendUrl}/api/v1/telegram/check/${chatId}`, {
						method: 'GET',
						headers: botHeaders,
					});
					const data = await response.json();
					if (data.success && data.phone) {
						bot.sendMessage(chatId, `
✅ *Your phone is already linked!*

Phone: ${maskPhone(data.phone)}

You will receive verification codes here when you register or reset your password in the Ema Store app.
						`, {
							parse_mode: 'Markdown',
							reply_markup: {
								inline_keyboard: [
									[{ text: '📱 Back to App', url: 'https://ema-store-backend.onrender.com' }]
								]
							}
						});
						return;
					}
				} catch (error) {
					console.error('[Bot] Check link error:', error.message);
				}

				// Not linked — ask for the contact via the share button.
				bot.sendMessage(chatId, `
👋 *Welcome to Ema Store Bot!*

This bot sends you verification codes when you register or reset your password.

Tap the button below to share your phone number and link your account:
				`, {
					parse_mode: 'Markdown',
					reply_markup: {
						keyboard: [
							[{ text: '📱 Share my phone number', request_contact: true }]
						],
						one_time_keyboard: true,
						resize_keyboard: true
					}
				});
			});

			// Handle contact sharing — the ONLY way a phone gets linked.
			// The contact must belong to the sender, otherwise anyone could
			// link a victim's number and steal their OTP codes.
			bot.on('contact', async (msg) => {
				const chatId = msg.chat.id;
				const contact = msg.contact;

				if (!contact || !contact.phone_number) {
					bot.sendMessage(chatId, '❌ Failed to get phone number. Please try again.');
					return;
				}

				if (contact.user_id !== msg.from.id) {
					bot.sendMessage(chatId, 'Please share your own number using the button.');
					return;
				}

				const phone = normalizePhone(contact.phone_number);

				try {
					const data = await linkPhone(chatId, phone, msg.from.username);

					if (data.success) {
						bot.sendMessage(chatId, `
✅ *Phone Number Linked Successfully!*

Your phone number: ${maskPhone(phone)}

You'll receive verification codes here when you register or reset your password.
						`, {
							parse_mode: 'Markdown',
							reply_markup: {
								remove_keyboard: true,
								inline_keyboard: [
									[{ text: '📱 Back to App', url: 'https://ema-store-backend.onrender.com' }]
								]
							}
						});
					} else if (data.code === 'PHONE_ALREADY_LINKED') {
						// Do NOT reveal the other account's username.
						bot.sendMessage(chatId, `
⚠️ *Phone Already Linked*

This phone number is already linked to a different Telegram account.

Please use the same Telegram account that you originally registered with, or contact support to unlink your phone number.
						`, {
							parse_mode: 'Markdown',
							reply_markup: {
								remove_keyboard: true
							}
						});
					} else {
						bot.sendMessage(chatId, `❌ Failed to link phone number: ${data.message}`, {
							reply_markup: {
								inline_keyboard: [
									[{ text: '📱 Back to App', url: 'https://ema-store-backend.onrender.com' }]
								]
							}
						});
					}
				} catch (error) {
					console.error('[Bot] Link error:', error.message);
					bot.sendMessage(chatId, '❌ Failed to link phone number. Please try again later.');
				}
			});

			// /link is kept for convenience, but it can no longer link a typed
			// number — only the Share Contact button proves phone ownership.
			bot.onText(/\/link/, async (msg) => {
				bot.sendMessage(msg.chat.id, `
🔗 *Linking is done securely now*

For your safety, phone numbers can only be linked by sharing your own contact.

Please go back and tap *Start* (@${process.env.TELEGRAM_BOT_USERNAME || 'your_bot'}) or send /start, then tap the *"Share my phone number"* button.
				`, { parse_mode: 'Markdown' });
			});

			// Handle bot errors - suppress conflict errors
			bot.on('polling_error', (error) => {
				// Completely suppress conflict errors
				if (error.code === 'ETELEGRAM' && error.message.includes('Conflict')) {
					// Do nothing - this is expected when multiple instances start
				} else {
					console.error(`[Bot] Error: ${error.code} - ${error.message}`);
				}
			});

			console.log('🤖 Telegram Bot: Started successfully');
		} catch (error) {
			console.error('🤖 Telegram Bot: Failed to start', error.message);
		}
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
