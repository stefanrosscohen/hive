import type { Context } from "telegraf";
import type { Orchestrator, TaskResult } from "../orchestrator/orchestrator.js";
import type { Notifier } from "../reporting/notifier.js";
import { settings } from "../config/settings.js";
import * as fmt from "./formatter.js";

// Store completed tasks for /history
const taskHistory: TaskResult[] = [];
const MAX_HISTORY = 50;

export function addToHistory(result: TaskResult): void {
  taskHistory.unshift(result);
  if (taskHistory.length > MAX_HISTORY) taskHistory.pop();
}

export function createCommandHandlers(orchestrator: Orchestrator, notifier: Notifier) {
  /**
   * /run <task> --budget <amount>
   */
  async function handleRun(ctx: Context): Promise<void> {
    const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
    const match = text.match(/^\/run\s+(.+?)(?:\s+--budget\s+([\d.]+))?$/);

    if (!match) {
      await ctx.reply("Usage: `/run <task description> --budget <amount>`", { parse_mode: "MarkdownV2" });
      return;
    }

    const task = match[1].trim();
    const budget = parseFloat(match[2] ?? String(settings.defaultBudget));
    const model = settings.defaultModel;

    // Acknowledge
    await ctx.reply(
      fmt.formatTaskStarted(task, budget, model, "starting..."),
      { parse_mode: "MarkdownV2" }
    );

    // Run in background
    orchestrator
      .runTask({ task, budget, model })
      .then((result) => {
        addToHistory(result);
        ctx.reply(fmt.formatTaskCompleted(result), { parse_mode: "MarkdownV2" }).catch(() => {});
      })
      .catch((err) => {
        ctx.reply(`❌ Error: ${err.message}`).catch(() => {});
      });
  }

  /**
   * /status
   */
  async function handleStatus(ctx: Context): Promise<void> {
    const taskIds = orchestrator.getActiveTaskIds();
    if (taskIds.length === 0) {
      await ctx.reply("No active tasks\\.", { parse_mode: "MarkdownV2" });
      return;
    }

    const tasks = taskIds.map((id) => {
      const budget = orchestrator.getTaskBudget(id);
      return {
        id,
        task: id.slice(0, 8),
        spent: budget?.spent ?? 0,
        budget: budget?.total ?? 0,
      };
    });

    await ctx.reply(fmt.formatBudgetStatus(tasks), { parse_mode: "MarkdownV2" });
  }

  /**
   * /budget
   */
  async function handleBudget(ctx: Context): Promise<void> {
    // Same as status for now
    await handleStatus(ctx);
  }

  /**
   * /history
   */
  async function handleHistory(ctx: Context): Promise<void> {
    if (taskHistory.length === 0) {
      await ctx.reply("No completed tasks yet\\.", { parse_mode: "MarkdownV2" });
      return;
    }

    const lines = taskHistory.slice(0, 10).map((t) => {
      const emoji = t.status === "completed" ? "✅" : t.status === "budget_exhausted" ? "💸" : "❌";
      return `${emoji} \`${fmt.escapeMarkdown(t.task.slice(0, 60))}\` — \\$${t.totalCost.toFixed(4)}`;
    });

    await ctx.reply(["📜 *Recent Tasks*", "", ...lines].join("\n"), { parse_mode: "MarkdownV2" });
  }

  /**
   * /cancel <task_id>
   */
  async function handleCancel(ctx: Context): Promise<void> {
    const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
    const match = text.match(/^\/cancel\s+(\S+)/);
    if (!match) {
      await ctx.reply("Usage: `/cancel <task_id>`", { parse_mode: "MarkdownV2" });
      return;
    }

    const taskId = match[1];
    const cancelled = orchestrator.cancelTask(taskId);
    await ctx.reply(cancelled ? `Cancelled task ${taskId}` : `Task ${taskId} not found`);
  }

  /**
   * /help
   */
  async function handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(fmt.formatHelp(), { parse_mode: "MarkdownV2" });
  }

  return { handleRun, handleStatus, handleBudget, handleHistory, handleCancel, handleHelp };
}
