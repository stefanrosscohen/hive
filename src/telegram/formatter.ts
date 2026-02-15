import type { TaskResult } from "../orchestrator/orchestrator.js";
import type { AgentResult } from "../agents/agent.js";

/**
 * Format messages for Telegram (MarkdownV2 compatible).
 */

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

export function formatTaskStarted(task: string, budget: number, model: string, taskId: string): string {
  return [
    "🐝 *New Task*",
    "",
    `\`${task.slice(0, 200)}\``,
    "",
    `💰 Budget: \\$${budget.toFixed(2)}`,
    `🤖 Model: ${escapeMarkdown(model)}`,
    `🆔 ${escapeMarkdown(taskId.slice(0, 8))}`,
  ].join("\n");
}

export function formatAgentStarted(name: string, subtask: string): string {
  return `⚡ *${escapeMarkdown(name)}* started:\n\`${subtask.slice(0, 150)}\``;
}

export function formatAgentDone(result: AgentResult): string {
  const emoji = result.status === "completed" ? "✅" : result.status === "budget_exhausted" ? "💸" : "❌";
  return [
    `${emoji} *${escapeMarkdown(result.name)}* ${escapeMarkdown(result.status)}`,
    `💰 \\$${result.totalCost.toFixed(4)} \\| ${result.turns} turns`,
  ].join("\n");
}

export function formatTaskCompleted(result: TaskResult): string {
  const emoji = result.status === "completed" ? "✅" : result.status === "budget_exhausted" ? "💸" : "❌";

  const agents = result.agentResults
    .map((r) => `  • ${escapeMarkdown(r.name)}: \\$${r.totalCost.toFixed(4)}`)
    .join("\n");

  return [
    `${emoji} *Task ${escapeMarkdown(result.status)}*`,
    "",
    `\`${result.task.slice(0, 150)}\``,
    "",
    `💰 Total: \\$${result.totalCost.toFixed(4)}`,
    "",
    "*Agents:*",
    agents,
    "",
    "*Output:*",
    `\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``,
  ].join("\n");
}

export function formatBudgetStatus(tasks: Array<{ id: string; task: string; spent: number; budget: number }>): string {
  if (tasks.length === 0) return "No active tasks\\.";

  const lines = tasks.map((t) => {
    const pct = ((t.spent / t.budget) * 100).toFixed(0);
    return `• ${escapeMarkdown(t.task.slice(0, 50))}\n  \\$${t.spent.toFixed(4)} / \\$${t.budget.toFixed(2)} \\(${pct}%\\)`;
  });

  return ["📊 *Active Tasks*", "", ...lines].join("\n");
}

export function formatHelp(): string {
  return [
    "🐝 *Hive Agent Swarm*",
    "",
    "*Commands:*",
    "/run \\<task\\> \\-\\-budget \\<amount\\> — Run a task",
    "/status — Active tasks and agents",
    "/budget — Budget breakdown",
    "/history — Recent completed tasks",
    "/cancel \\<task\\_id\\> — Cancel a running task",
    "/help — This message",
    "",
    "*Examples:*",
    '`/run build a REST API for todos --budget 5.00`',
    '`/run fix issue #42 --budget 2.00`',
  ].join("\n");
}
