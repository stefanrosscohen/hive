import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { settings } from "../config/settings.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { Notifier } from "../reporting/notifier.js";
import { createCommandHandlers, addToHistory } from "./commands.js";
import type { ImageAttachment } from "../providers/provider.js";

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

  // Handle photos (with optional caption as task description)
  bot.on(message("photo"), async (ctx) => {
    const caption = ctx.message.caption ?? "Analyze this image and do what it asks";
    const photos = ctx.message.photo;
    // Telegram sends multiple sizes — grab the largest
    const largest = photos[photos.length - 1];

    await ctx.reply(`📸 Got image. Running: "${caption.slice(0, 80)}"...`);

    try {
      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      const image: ImageAttachment = {
        type: "base64",
        mediaType: "image/jpeg",
        data: base64,
      };

      orchestrator
        .runTaskWithImages({
          task: caption,
          budget: settings.defaultBudget,
          model: settings.defaultModel,
          images: [image],
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
    } catch (err: any) {
      await ctx.reply(`❌ Failed to process image: ${err.message}`);
    }
  });

  // Handle documents (images sent as files)
  bot.on(message("document"), async (ctx) => {
    const doc = ctx.message.document;
    const mime = doc.mime_type ?? "";

    if (!mime.startsWith("image/")) {
      await ctx.reply("I can only process image files for now.");
      return;
    }

    const caption = ctx.message.caption ?? "Analyze this image and do what it asks";
    await ctx.reply(`📎 Got image file. Running: "${caption.slice(0, 80)}"...`);

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      const mediaType = mime as ImageAttachment["mediaType"];
      const image: ImageAttachment = {
        type: "base64",
        mediaType: ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)
          ? mediaType
          : "image/jpeg",
        data: base64,
      };

      orchestrator
        .runTaskWithImages({
          task: caption,
          budget: settings.defaultBudget,
          model: settings.defaultModel,
          images: [image],
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
    } catch (err: any) {
      await ctx.reply(`❌ Failed to process file: ${err.message}`);
    }
  });

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
