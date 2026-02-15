import { Telegraf } from "telegraf";
import { settings } from "../config/settings.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { Notifier } from "../reporting/notifier.js";
import { createCommandHandlers, addToHistory } from "./commands.js";

export function createTelegramBot(orchestrator: Orchestrator, notifier: Notifier): Telegraf | null {
  if (!settings.telegramBotToken) {
    console.log("[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot setup");
    return null;
  }

  const bot = new Telegraf(settings.telegramBotToken);

  // Auth middleware — only respond to the owner
  bot.use((ctx, next) => {
    const userId = String(ctx.from?.id ?? "");
    if (settings.telegramOwnerId && userId !== settings.telegramOwnerId) {
      ctx.reply("Unauthorized. This bot only responds to its owner.");
      return;
    }
    return next();
  });

  // Wire up notifier to send via Telegram
  notifier.setTelegram({
    async sendMessage(chatId: string, text: string) {
      try {
        await bot.telegram.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
      } catch {
        // Fallback to plain text
        await bot.telegram.sendMessage(chatId, text.replace(/[\\*_`\[\]()~>#+\-=|{}.!]/g, ""));
      }
    },
  });

  // Track completed tasks for history
  orchestrator.on("completed", (result) => {
    addToHistory(result);
  });

  // Register commands
  const handlers = createCommandHandlers(orchestrator, notifier);

  bot.command("run", handlers.handleRun);
  bot.command("status", handlers.handleStatus);
  bot.command("budget", handlers.handleBudget);
  bot.command("history", handlers.handleHistory);
  bot.command("cancel", handlers.handleCancel);
  bot.command("help", handlers.handleHelp);
  bot.command("start", handlers.handleHelp);

  // Handle plain text as tasks with default budget
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // Unknown command

    // Treat any plain message as a task
    await ctx.reply(`Running task with default budget ($${settings.defaultBudget})...`);

    orchestrator
      .runTask({
        task: text,
        budget: settings.defaultBudget,
        model: settings.defaultModel,
      })
      .then((result) => {
        addToHistory(result);
        const emoji = result.status === "completed" ? "✅" : "❌";
        ctx.reply(
          `${emoji} Done ($${result.totalCost.toFixed(4)})\n\n${result.output.slice(0, 3000)}`
        ).catch(() => {});
      })
      .catch((err) => {
        ctx.reply(`❌ Error: ${err.message}`).catch(() => {});
      });
  });

  return bot;
}

/**
 * Start the bot in long-polling mode.
 */
export async function startTelegramBot(bot: Telegraf): Promise<void> {
  console.log("[Telegram] Starting bot in long-polling mode...");

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  await bot.launch();
  console.log("[Telegram] Bot is running");
}
