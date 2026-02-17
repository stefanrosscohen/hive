import { v4 as uuid } from "uuid";
import { EventEmitter } from "eventemitter3";
import type {
  LLMProvider,
  Message,
  ToolCall,
  ToolResult,
  Usage,
  ToolDefinition,
  ImageAttachment,
} from "../providers/provider.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface AgentConfig {
  id?: string;
  name: string;
  model: string;
  systemPrompt: string;
  provider: LLMProvider;
  tools: ToolRegistry;
  budget: number; // max dollars to spend
  maxTurns?: number; // safety limit on iterations (default: 100)
}

export interface AgentEvents {
  thinking: (text: string) => void;
  tool_call: (name: string, args: Record<string, unknown>) => void;
  tool_result: (name: string, result: string) => void;
  cost_update: (cost: number, budget: number) => void;
  done: (result: AgentResult) => void;
  error: (error: Error) => void;
}

export interface AgentResult {
  id: string;
  name: string;
  output: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turns: number;
  status: "completed" | "budget_exhausted" | "max_turns" | "error";
}

export class Agent extends EventEmitter<AgentEvents> {
  readonly id: string;
  readonly name: string;

  private config: AgentConfig;
  private messages: Message[] = [];
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private turns = 0;
  private aborted = false;

  constructor(config: AgentConfig) {
    super();
    this.id = config.id ?? uuid();
    this.name = config.name;
    this.config = config;
  }

  get spent(): number {
    return this.totalCost;
  }

  get remainingBudget(): number {
    return Math.max(0, this.config.budget - this.totalCost);
  }

  abort(): void {
    this.aborted = true;
  }

  /**
   * Run the agent on a task. Returns when the agent is done or budget is exhausted.
   * Optionally attach images to the initial message (for vision tasks).
   */
  async run(task: string, images?: ImageAttachment[]): Promise<AgentResult> {
    const maxTurns = this.config.maxTurns ?? 100;

    // Initial user message (with optional images)
    const initialMessage: Message = { role: "user", content: task };
    if (images?.length) {
      initialMessage.images = images;
    }
    this.messages.push(initialMessage);

    try {
      while (this.turns < maxTurns && !this.aborted) {
        // Budget check before calling LLM
        if (this.totalCost >= this.config.budget) {
          return this.finish("budget_exhausted");
        }

        // Call LLM
        const response = await this.config.provider.chat(
          this.messages,
          this.config.tools.getDefinitions(),
          this.config.model,
          this.config.systemPrompt
        );

        // Track costs
        this.totalCost += response.usage.cost;
        this.totalInputTokens += response.usage.inputTokens;
        this.totalOutputTokens += response.usage.outputTokens;
        this.turns++;

        this.emit("cost_update", this.totalCost, this.config.budget);

        // Emit thinking text
        if (response.content) {
          this.emit("thinking", response.content);
        }

        // If no tool calls, the agent is done
        if (response.toolCalls.length === 0) {
          // Add assistant response to history
          this.messages.push({
            role: "assistant",
            content: response.content,
          });
          return this.finish("completed", response.content);
        }

        // Add assistant message with tool calls
        this.messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute all tool calls — NO PERMISSION CHECKS
        const toolResults: ToolResult[] = [];

        for (const toolCall of response.toolCalls) {
          this.emit("tool_call", toolCall.name, toolCall.arguments);

          const result = await this.config.tools.execute(
            toolCall.name,
            toolCall.arguments
          );

          this.emit("tool_result", toolCall.name, result);

          toolResults.push({
            toolCallId: toolCall.id,
            content: result,
          });
        }

        // Add tool results to messages
        this.messages.push({
          role: "tool",
          content: "",
          toolResults,
        });
      }

      // Hit max turns
      return this.finish(this.aborted ? "error" : "max_turns");
    } catch (err: any) {
      this.emit("error", err);
      return this.finish("error", `Error: ${err.message}`);
    }
  }

  private finish(
    status: AgentResult["status"],
    output?: string
  ): AgentResult {
    // Extract last meaningful output
    const finalOutput =
      output ??
      this.messages
        .filter((m) => m.role === "assistant" && m.content)
        .pop()?.content ??
      `Agent ${this.name} finished with status: ${status}`;

    const result: AgentResult = {
      id: this.id,
      name: this.name,
      output: finalOutput,
      totalCost: this.totalCost,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      turns: this.turns,
      status,
    };

    this.emit("done", result);
    return result;
  }
}
