import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const CHANNEL = "@bakicoins"; // must match the channel you want to force-join
const CHANNEL_URL = `https://t.me/${CHANNEL.replace("@", "")}`;

if (!token || !webAppUrl) {
  console.error("Set BOT_TOKEN and WEBAPP_URL in your .env file first.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// True if the user is a member/admin/creator of the channel.
// The bot itself must be added to the channel (like any subscriber) for this to work.
async function isChannelMember(userId) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(
        CHANNEL
      )}&user_id=${userId}`
    );
    const data = await res.json();
    return ["member", "administrator", "creator"].includes(data.result?.status);
  } catch (err) {
    console.error("Membership check failed:", err);
    return false; // fail closed — require the join if we can't verify
  }
}

function sendAppButton(chatId, referralCode) {
  const url = referralCode ? `${webAppUrl}?ref=${referralCode}` : webAppUrl;
  bot.sendMessage(chatId, "Welcome! Tap the button below to start earning:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 Open App", web_app: { url } }]],
    },
  });
}

bot.onText(/\/start(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];

  if (!(await isChannelMember(msg.from.id))) {
    return bot.sendMessage(
      chatId,
      `👋 Welcome!\n\nTo use this app you first need to join our channel: ${CHANNEL}\n\nJoin it, then tap "✅ I joined" below.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Join Channel", url: CHANNEL_URL }],
            [{ text: "✅ I joined", callback_data: `joined:${referralCode || ""}` }],
          ],
        },
      }
    );
  }

  sendAppButton(chatId, referralCode);
});

bot.on("callback_query", async (query) => {
  if (!query.data?.startsWith("joined:")) return;
  const referralCode = query.data.slice(7) || undefined;

  if (!(await isChannelMember(query.from.id))) {
    return bot.answerCallbackQuery(query.id, {
      text: "You haven't joined the channel yet!",
      show_alert: true,
    });
  }

  await bot.answerCallbackQuery(query.id, { text: "Verified! ✅" });
  sendAppButton(query.message.chat.id, referralCode);
});

console.log("Bot is running...");