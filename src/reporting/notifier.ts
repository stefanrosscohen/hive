import type { Orchestrator, TaskResult } from "../orchestrator/orchestrator.js";
import type { AgentResult } from "../agents/agent.js";
import { settings } from "../config/settings.js";
import * as notion from "../tools/notion.js";
import * as hyperstitial from "../tools/hyperstitial.js";

export type NotifyChannel = "console" | "notion" | "hyperstitial" | "telegram";

interface TelegramNotifier {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export class Notifier {
  private channels: Set<NotifyChannel> = new Set(["console"]);
  private notionPageIds = new Map<string, string>(); // taskId -> pageId
  private telegram: TelegramNotifier | null = null;

  constructor(channels?: NotifyChannel[]) {
    if (channels) {
      this.channels = new Set(channels);
    }
    // Auto-enable channels based on config
    if (settings.notionToken) this.channels.add("notion");
    if (settings.telegramBotToken) this.channels.add("telegram");
  }

  setTelegram(notifier: TelegramNotifier): void {
    this.telegram = notifier;
    this.channels.add("telegram");
  }

  /**
   * Wire up an orchestrator to send notifications on events.
   */
  attach(orchestrator: Orchestrator): void {
    orchestrator.on("started", (taskId) => this.onTaskStarted(taskId));
    orchestrator.on("agent_started", (id, name, task) => this.onAgentStarted(id, name, task));
    orchestrator.on("agent_done", (result) => this.onAgentDone(result));
    orchestrator.on("cost_update", (spent, budget) => this.onCostUpdate(spent, budget));
    orchestrator.on("completed", (result) => this.onTaskCompleted(result));
    orchestrator.on("error", (error) => this.onError(error));
  }

  private async onTaskStarted(taskId: string): Promise<void> {
    const msg = `Task started: ${taskId.slice(0, 8)}`;
    this.log(msg);

    if (this.channels.has("hyperstitial")) {
      await hyperstitial.startSession(taskId);
    }
  }

  async notifyTaskCreated(taskId: string, task: string, budget: number, model: string): Promise<void> {
    if (this.channels.has("notion")) {
      try {
        const pageId = await notion.createTaskEntry({ taskId, task, budget, model });
        this.notionPageIds.set(taskId, pageId);
      } catch (err: any) {
        this.log(`Notion error: ${err.message}`);
      }
    }

    if (this.channels.has("telegram") && this.telegram) {
      await this.telegram.sendMessage(
        settings.telegramOwnerId,
        `🐝 *Task Started*\n\`${task.slice(0, 100)}\`\nBudget: $${budget.toFixed(2)}\nModel: ${model}`
      );
    }
  }

  private async onAgentStarted(agentId: string, name: string, task: string): Promise<void> {
    const msg = `Agent ${name} (${agentId.slice(0, 8)}) started: ${task.slice(0, 100)}`;
    this.log(msg);

    if (this.channels.has("hyperstitial")) {
      // Find task ID from context
      await hyperstitial.sendUpdate(agentId, msg);
    }
  }

  private async onAgentDone(result: AgentResult): Promise<void> {
    const msg = `Agent ${result.name} done [${result.status}] — $${result.totalCost.toFixed(4)} spent, ${result.turns} turns`;
    this.log(msg);
  }

  private async onCostUpdate(spent: number, budget: number): Promise<void> {
    const pct = ((spent / budget) * 100).toFixed(1);
    this.log(`Cost: $${spent.toFixed(4)} / $${budget.toFixed(2)} (${pct}%)`);
  }

  private async onTaskCompleted(result: TaskResult): Promise<void> {
    const statusEmoji = result.status === "completed" ? "✅" : result.status === "budget_exhausted" ? "💸" : "❌";
    const msg = `${statusEmoji} Task ${result.status}: $${result.totalCost.toFixed(4)} spent`;
    this.log(msg);

    // Update Notion
    const pageId = this.notionPageIds.get(result.taskId);
    if (pageId && this.channels.has("notion")) {
      try {
        await notion.updateTaskEntry(pageId, {
          status: result.status === "completed" ? "Completed" : result.status === "budget_exhausted" ? "Budget Exhausted" : "Failed",
          spent: result.totalCost,
          agents: result.agentResults.map((r) => r.name).join(", "),
          output: result.output.slice(0, 2000),
        });
      } catch (err: any) {
        this.log(`Notion update error: ${err.message}`);
      }
    }

    // Telegram
    if (this.channels.has("telegram") && this.telegram) {
      const summary = [
        `${statusEmoji} *Task ${result.status}*`,
        `\`${result.task.slice(0, 100)}\``,
        `Cost: $${result.totalCost.toFixed(4)}`,
        `Agents: ${result.agentResults.map((r) => `${r.name} ($${r.totalCost.toFixed(4)})`).join(", ")}`,
      ].join("\n");
      await this.telegram.sendMessage(settings.telegramOwnerId, summary);
    }

    // Hyperstitial
    if (this.channels.has("hyperstitial")) {
      await hyperstitial.sendUpdate(result.taskId, msg);
      hyperstitial.closeSession(result.taskId);
    }
  }

  private async onError(error: Error): Promise<void> {
    this.log(`Error: ${error.message}`);
  }

  private log(msg: string): void {
    if (this.channels.has("console")) {
      console.log(`[Hive] ${msg}`);
    }
  }
}
