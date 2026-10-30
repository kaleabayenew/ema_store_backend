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
	if (botToken) {
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

			// Handle /start command
			bot.onText(/\/start/, async (msg) => {
				const chatId = msg.chat.id;
				const username = msg.from.username;

				// Check if user already has a linked phone number
				try {
					const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
					const response = await fetch(`${backendUrl}/api/v1/telegram/check/${chatId}`, {
						method: 'GET',
						headers: {
							'Content-Type': 'application/json',
						},
					});

					const data = await response.json();

					if (data.success && data.phone) {
						// Phone already linked
						bot.sendMessage(chatId, `
✅ *Your phone is already linked!*

Phone: ${data.phone}

You will receive verification codes here when you register or reset your password in the Ema Store app.
						`, { parse_mode: 'Markdown' });
						return;
					}
				} catch (error) {
					console.error('[Bot] Check link error:', error);
				}

				// Phone not linked, ask user to share it
				pendingPhoneRequests.set(chatId, Date.now());
				bot.sendMessage(chatId, `
👋 *Welcome to Ema Store Bot!*

This bot will send you verification codes when you register or reset your password.

Please share your phone number to link it:

📱 *Option 1:* Click the button below to share your phone number
📱 *Option 2:* Type it manually: +251912345678
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

			// Handle contact sharing (when user clicks "Share my phone number")
			bot.on('contact', async (msg) => {
				const chatId = msg.chat.id;
				const contact = msg.contact;
				const username = msg.from.username;

				if (!contact || !contact.phone_number) {
					bot.sendMessage(chatId, '❌ Failed to get phone number. Please try again.');
					return;
				}

				// Format phone number (add + if missing)
				let phone = contact.phone_number;
				if (!phone.startsWith('+')) {
					phone = '+' + phone;
				}

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
						pendingPhoneRequests.delete(chatId);
						
						// Send a test OTP to verify the link works
						const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
						await bot.sendMessage(chatId, `
✅ *Phone Number Linked Successfully!*

Your phone number: ${phone}

We'll send a test code to verify everything is working...
						`, { 
							parse_mode: 'Markdown',
							reply_markup: {
								remove_keyboard: true
							}
						});

						// Send test OTP after a short delay
						setTimeout(async () => {
							try {
								await bot.sendMessage(chatId, `
🔐 *Test Verification Code*

Your test code is: *${testOtp}*

This confirms your phone is linked correctly. You'll receive real codes when you register or reset your password.
								`, { parse_mode: 'Markdown' });
							} catch (error) {
								console.error('[Bot] Failed to send test OTP:', error);
							}
						}, 1000);
					} else {
						bot.sendMessage(chatId, `❌ Failed to link phone number: ${data.message}`);
					}
				} catch (error) {
					console.error('[Bot] Link error:', error);
					bot.sendMessage(chatId, '❌ Failed to link phone number. Please try again later.');
				}
			});

			// Handle phone number input (when user sends a number after /start)
			bot.on('message', async (msg) => {
				const chatId = msg.chat.id;
				const text = msg.text;

				// Skip commands and contacts
				if (text?.startsWith('/') || msg.contact) return;

				// Check if this is a pending phone number request
				if (pendingPhoneRequests.has(chatId)) {
					const phone = text.trim();
					const username = msg.from.username;

					// Validate phone number format (basic check)
					if (!phone.match(/^\+\d{10,15}$/)) {
						bot.sendMessage(chatId, `
❌ *Invalid Phone Number Format*

Please use the format: +251912345678

Include the country code (+251 for Ethiopia) and 9-12 digits.

Or click the button below to share your phone number automatically.
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
						return;
					}

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
							pendingPhoneRequests.delete(chatId);
							
							// Send a test OTP to verify the link works
							const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
							await bot.sendMessage(chatId, `
✅ *Phone Number Linked Successfully!*

Your phone number: ${phone}

We'll send a test code to verify everything is working...
							`, { 
								parse_mode: 'Markdown',
								reply_markup: {
									remove_keyboard: true
								}
							});

							// Send test OTP after a short delay
							setTimeout(async () => {
								try {
									await bot.sendMessage(chatId, `
🔐 *Test Verification Code*

Your test code is: *${testOtp}*

This confirms your phone is linked correctly. You'll receive real codes when you register or reset your password.
									`, { parse_mode: 'Markdown' });
								} catch (error) {
									console.error('[Bot] Failed to send test OTP:', error);
								}
							}, 1000);
						} else {
							bot.sendMessage(chatId, `❌ Failed to link phone number: ${data.message}`);
						}
					} catch (error) {
						console.error('[Bot] Link error:', error);
						bot.sendMessage(chatId, '❌ Failed to link phone number. Please try again later.');
					}
				} else {
					// If not pending, don't respond to random messages
					// Only respond to commands
					if (!text?.startsWith('/')) {
						return;
					}
					
					bot.sendMessage(chatId, `
Please use the commands:
- /start - Link your phone number
- /link <phone> - Link your phone number directly
					`);
				}
			});

			// Handle /link command (direct link with phone number)
			bot.onText(/\/link (.+)/, async (msg, match) => {
				const chatId = msg.chat.id;
				const phone = match[1].trim();
				const username = msg.from.username;

				// Validate phone number format
				if (!phone.match(/^\+\d{10,15}$/)) {
					bot.sendMessage(chatId, `
❌ *Invalid Phone Number Format*

Please use the format: +251912345678

Include the country code (+251 for Ethiopia) and 9-12 digits.
					`, { parse_mode: 'Markdown' });
					return;
				}

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
						// Send a test OTP to verify the link works
						const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
						await bot.sendMessage(chatId, `
✅ *Phone Number Linked Successfully!*

Your phone number: ${phone}

We'll send a test code to verify everything is working...
						`, { parse_mode: 'Markdown' });

						// Send test OTP after a short delay
						setTimeout(async () => {
							try {
								await bot.sendMessage(chatId, `
🔐 *Test Verification Code*

Your test code is: *${testOtp}*

This confirms your phone is linked correctly. You'll receive real codes when you register or reset your password.
								`, { parse_mode: 'Markdown' });
							} catch (error) {
								console.error('[Bot] Failed to send test OTP:', error);
							}
						}, 1000);
					} else {
						bot.sendMessage(chatId, `❌ Failed to link phone number: ${data.message}`);
					}
				} catch (error) {
					console.error('[Bot] Link error:', error);
					bot.sendMessage(chatId, '❌ Failed to link phone number. Please try again later.');
				}
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
