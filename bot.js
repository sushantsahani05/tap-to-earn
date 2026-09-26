import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

if (!token || !webAppUrl) {
  console.error("Set BOT_TOKEN and WEBAPP_URL in your .env file first.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start(?:\s+(\S+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1]; // e.g. /start abc123 from an invite link
  const url = referralCode ? `${webAppUrl}?ref=${referralCode}` : webAppUrl;

  bot.sendMessage(chatId, "Welcome! Tap the button below to start earning:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 Open App", web_app: { url } }]],
    },
  });
});

console.log("Bot is running...");
