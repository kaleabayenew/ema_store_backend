const {
  getOwnerChatId,
  approveRelease,
  rejectRelease,
} = require('./app-update.service');

/**
 * Registers callback query handlers for app release approval/rejection on the running Telegram Bot.
 * @param {import('node-telegram-bot-api')} bot
 */
const registerAppUpdateBotHandlers = (bot) => {
  if (!bot) return;

  const ownerChatId = String(getOwnerChatId());

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const fromId = String(query.from.id);
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;

    // Verify it's an update approval action
    if (!data.startsWith('approve_rel:') && !data.startsWith('reject_rel:')) {
      return;
    }

    // Security Check: Only the Owner can approve or reject releases
    if (fromId !== ownerChatId && String(chatId) !== ownerChatId) {
      return bot.answerCallbackQuery(query.id, {
        text: '⛔ Unauthorized: Only the app owner can approve releases.',
        show_alert: true,
      });
    }

    if (data.startsWith('approve_rel:')) {
      const releaseId = data.replace('approve_rel:', '');
      const result = await approveRelease(releaseId, bot);

      if (result.success) {
        await bot.answerCallbackQuery(query.id, {
          text: result.message || '✅ Release Approved & Published!',
          show_alert: true,
        });

        // Strip the inline buttons so it cannot be tapped again
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (_) {}

        // Keep the APK in chat and append the live approval timestamp
        const statusNotice = `\n\n✅ *STATUS: APPROVED & LIVE*\n⏰ *Time:* ${new Date().toLocaleString()}`;
        try {
          if (query.message?.caption) {
            await bot.editMessageCaption(query.message.caption + statusNotice, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown',
            });
          } else if (query.message?.text) {
            await bot.editMessageText(query.message.text + statusNotice, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown',
            });
          }
        } catch (_) {}
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: result.message,
          show_alert: true,
        });
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (_) {}
      }
    } else if (data.startsWith('reject_rel:')) {
      const releaseId = data.replace('reject_rel:', '');
      const result = await rejectRelease(releaseId);

      await bot.answerCallbackQuery(query.id, {
        text: '❌ Release Cancelled.',
        show_alert: true,
      });

      // Strip buttons and mark rejected
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: messageId }
        );
      } catch (_) {}

      const rejectNotice = `\n\n❌ *STATUS: REJECTED & CANCELLED*\n⏰ *Time:* ${new Date().toLocaleString()}`;
      try {
        if (query.message?.caption) {
          await bot.editMessageCaption(query.message.caption + rejectNotice, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          });
        } else if (query.message?.text) {
          await bot.editMessageText(query.message.text + rejectNotice, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          });
        }
      } catch (_) {}
    }
  });

  console.log('🤖 Telegram Bot: App Update Release Handlers registered (Owner ID: ' + ownerChatId + ')');
};

module.exports = {
  registerAppUpdateBotHandlers,
};

