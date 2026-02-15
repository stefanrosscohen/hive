import { v4 as uuid } from "uuid";
import { EventEmitter } from "eventemitter3";
import { Agent, type AgentResult } from "../agents/agent.js";
import { AGENT_PRESETS, type AgentPreset } from "../agents/presets.js";
import { BudgetManager } from "./budget.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAIProvider } from "../providers/openai.js";
import type { LLMProvider } from "../providers/provider.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import { getProvider } from "../config/models.js";
import { settings } from "../config/settings.js";

export interface TaskConfig {
  task: string;
  budget: number;
  model?: string;
  repo?: string; // owner/repo for GitHub integration
}

export interface TaskEvents {
  started: (taskId: string) => void;
  agent_started: (agentId: string, name: string, subtask: string) => void;
  agent_thinking: (agentId: string, text: string) => void;
  agent_tool_call: (agentId: string, tool: string, args: Record<string, unknown>) => void;
  agent_tool_result: (agentId: string, tool: string, result: string) => void;
  agent_done: (result: AgentResult) => void;
  cost_update: (spent: number, budget: number) => void;
  completed: (result: TaskResult) => void;
  error: (error: Error) => void;
}

export interface TaskResult {
  taskId: string;
  task: string;
  output: string;
  totalCost: number;
  agentResults: AgentResult[];
  status: "completed" | "budget_exhausted" | "error";
}

interface SubTask {
  id: number;
  description: string;
  agentType: AgentPreset;
  complexity: "simple" | "medium" | "complex";
  dependsOn: number[];
}

export class Orchestrator extends EventEmitter<TaskEvents> {
  private providers: Map<string, LLMProvider> = new Map();
  private toolRegistry: ToolRegistry | null = null;
  private activeAgents: Map<string, Agent> = new Map();
  private activeTasks: Map<string, { config: TaskConfig; budget: BudgetManager }> = new Map();

  constructor() {
    super();
    this.initProviders();
  }

  private initProviders(): void {
    if (settings.anthropicApiKey) {
      this.providers.set("anthropic", new AnthropicProvider(settings.anthropicApiKey));
    }
    if (settings.openaiApiKey) {
      this.providers.set("openai", new OpenAIProvider(settings.openaiApiKey));
    }
  }

  private getProvider(model: string): LLMProvider {
    const providerName = getProvider(model);
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `No ${providerName} provider configured. Set ${providerName === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}`
      );
    }
    return provider;
  }

  private async getToolRegistry(): Promise<ToolRegistry> {
    if (!this.toolRegistry) {
      this.toolRegistry = await createToolRegistry(settings.workspaceDir);
    }
    return this.toolRegistry;
  }

  /**
   * Run a task. This is the main entry point.
   * For simple tasks, runs a single coder agent.
   * For complex tasks, plans and delegates to multiple agents.
   */
  async runTask(config: TaskConfig): Promise<TaskResult> {
    const taskId = uuid();
    const model = config.model ?? settings.defaultModel;
    const budget = new BudgetManager(config.budget);

    this.activeTasks.set(taskId, { config, budget });
    this.emit("started", taskId);

    const tools = await this.getToolRegistry();
    const agentResults: AgentResult[] = [];

    try {
      // Step 1: Plan the task (use 10% of budget)
      const planBudget = budget.allocate("planner", config.budget * 0.1);
      const subtasks = await this.planTask(config.task, model, tools, planBudget, budget);

      if (subtasks.length === 0) {
        // Simple task — just run a single coder agent
        const agentBudget = budget.allocate("single-coder", budget.remaining);
        const result = await this.runAgent(
          taskId,
          "coder",
          config.task,
          model,
          tools,
          agentBudget,
          budget
        );
        agentResults.push(result);
      } else {
        // Complex task — execute subtasks
        // Sort by dependencies and execute
        const completed = new Set<number>();

        for (const subtask of this.topologicalSort(subtasks)) {
          // Check budget
          if (budget.remaining <= 0) break;

          // Wait for dependencies
          const depsReady = subtask.dependsOn.every((d) => completed.has(d));
          if (!depsReady) continue;

          // Allocate budget based on complexity
          const budgetMultiplier =
            subtask.complexity === "complex" ? 0.35 : subtask.complexity === "medium" ? 0.2 : 0.1;
          const agentBudget = budget.allocate(
            `agent-${subtask.id}`,
            config.budget * budgetMultiplier
          );

          if (agentBudget <= 0) break;

          const result = await this.runAgent(
            taskId,
            subtask.agentType,
            subtask.description,
            model,
            tools,
            agentBudget,
            budget
          );
          agentResults.push(result);
          completed.add(subtask.id);
        }
      }

      const output = agentResults
        .map((r) => `[${r.name}] ${r.status}: ${r.output.slice(0, 500)}`)
        .join("\n\n");

      const taskResult: TaskResult = {
        taskId,
        task: config.task,
        output,
        totalCost: budget.spent,
        agentResults,
        status: budget.remaining <= 0 ? "budget_exhausted" : "completed",
      };

      this.emit("completed", taskResult);
      this.activeTasks.delete(taskId);
      return taskResult;
    } catch (err: any) {
      const taskResult: TaskResult = {
        taskId,
        task: config.task,
        output: `Error: ${err.message}`,
        totalCost: budget.spent,
        agentResults,
        status: "error",
      };
      this.emit("error", err);
      this.activeTasks.delete(taskId);
      return taskResult;
    }
  }

  /**
   * Plan a task by asking the planner agent to decompose it.
   */
  private async planTask(
    task: string,
    model: string,
    tools: ToolRegistry,
    budget: number,
    budgetManager: BudgetManager
  ): Promise<SubTask[]> {
    if (budget <= 0) return [];

    const provider = this.getProvider(model);
    const plannerPreset = AGENT_PRESETS.planner;

    const agent = new Agent({
      name: "Planner",
      model,
      systemPrompt: plannerPreset.systemPrompt,
      provider,
      tools,
      budget,
    });

    agent.on("cost_update", (cost) => {
      budgetManager.recordSpend("planner", cost);
    });

    const result = await agent.run(
      `Plan this task. If it's simple enough for one agent, return an empty array []. ` +
      `Otherwise decompose it into subtasks.\n\nTask: ${task}`
    );

    // Parse the planner's output
    try {
      const jsonMatch = result.output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as SubTask[];
        }
      }
    } catch {
      // If parsing fails, treat as simple task
    }

    return [];
  }

  /**
   * Run a single agent on a subtask.
   */
  private async runAgent(
    taskId: string,
    preset: AgentPreset,
    task: string,
    model: string,
    tools: ToolRegistry,
    budget: number,
    budgetManager: BudgetManager
  ): Promise<AgentResult> {
    const provider = this.getProvider(model);
    const presetConfig = AGENT_PRESETS[preset];

    const agent = new Agent({
      name: presetConfig.name,
      model,
      systemPrompt: presetConfig.systemPrompt,
      provider,
      tools,
      budget,
    });

    // Wire up events
    this.activeAgents.set(agent.id, agent);

    agent.on("thinking", (text) => this.emit("agent_thinking", agent.id, text));
    agent.on("tool_call", (name, args) => this.emit("agent_tool_call", agent.id, name, args));
    agent.on("tool_result", (name, result) => this.emit("agent_tool_result", agent.id, name, result));
    agent.on("cost_update", (cost, agentBudget) => {
      budgetManager.recordSpend(agent.id, cost);
      this.emit("cost_update", budgetManager.spent, budgetManager.budget);
    });

    this.emit("agent_started", agent.id, presetConfig.name, task);

    const result = await agent.run(task);

    this.emit("agent_done", result);
    this.activeAgents.delete(agent.id);
    budgetManager.release(agent.id);

    return result;
  }

  /**
   * Simple topological sort for subtask dependencies.
   */
  private topologicalSort(subtasks: SubTask[]): SubTask[] {
    const sorted: SubTask[] = [];
    const visited = new Set<number>();

    const visit = (task: SubTask) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      for (const depId of task.dependsOn) {
        const dep = subtasks.find((t) => t.id === depId);
        if (dep) visit(dep);
      }
      sorted.push(task);
    };

    for (const task of subtasks) visit(task);
    return sorted;
  }

  /**
   * Cancel a running task.
   */
  cancelTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) return false;
    // Abort all active agents
    for (const agent of this.activeAgents.values()) {
      agent.abort();
    }
    this.activeTasks.delete(taskId);
    return true;
  }

  getActiveTaskIds(): string[] {
    return Array.from(this.activeTasks.keys());
  }

  getTaskBudget(taskId: string): { spent: number; remaining: number; total: number } | null {
    const task = this.activeTasks.get(taskId);
    if (!task) return null;
    return task.budget.getSummary();
  }
}
