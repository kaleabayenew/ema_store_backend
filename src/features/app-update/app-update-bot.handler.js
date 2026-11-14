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
          text: '✅ Release Approved & Published!',
          show_alert: true,
        });

        const newText = [
          `🎉 *RELEASE APPROVED & PUBLISHED!*`,
          ``,
          `📱 *App:* ${result.release.app.toUpperCase()}`,
          `🏷 *Live Version:* v${result.release.version} (Build ${result.release.buildNumber})`,
          `⚠️ *Type:* ${result.release.forceUpdate ? '🚨 Mandatory Force Update' : '🟢 Optional Update'}`,
          `⏰ *Approved At:* ${new Date().toLocaleString()}`,
          ``,
          `✅ *All app users will now receive this update on their phones.*`,
        ].join('\n');

        if (query.message.caption) {
          await bot.editMessageCaption(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [] },
          });
        } else {
          await bot.editMessageText(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [] },
          });
        }
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: result.message,
          show_alert: true,
        });
      }
    } else if (data.startsWith('reject_rel:')) {
      const releaseId = data.replace('reject_rel:', '');
      const result = await rejectRelease(releaseId);

      await bot.answerCallbackQuery(query.id, {
        text: '❌ Release Cancelled.',
        show_alert: true,
      });

      const newText = [
        `❌ *RELEASE REJECTED & CANCELLED*`,
        ``,
        `Version: v${result.release?.version || 'N/A'}`,
        `Time: ${new Date().toLocaleString()}`,
        ``,
        `_Nothing was published to users._`,
      ].join('\n');

      if (query.message.caption) {
        await bot.editMessageCaption(newText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] },
        });
      } else {
        await bot.editMessageText(newText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] },
        });
      }
    }
  });

  console.log('🤖 Telegram Bot: App Update Release Handlers registered (Owner ID: ' + ownerChatId + ')');
};

module.exports = {
  registerAppUpdateBotHandlers,
};

