import OpenAI from "openai";
import { LLMProvider, type Message, type ToolDefinition, type LLMResponse, type ToolCall } from "./provider.js";
import { calculateCost } from "../config/models.js";

export class OpenAIProvider extends LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const openaiMessages = this.convertMessages(messages, systemPrompt);
    const openaiTools = this.convertTools(tools);

    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: openaiMessages,
      ...(openaiTools.length > 0 && { tools: openaiTools }),
    };

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const textContent = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const cost = calculateCost(model, inputTokens, outputTokens);

    this.emit("stream", { type: "done" });

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        cost,
      },
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    };
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const toolCalls = msg.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        result.push({
          role: "assistant",
          content: msg.content || null,
          ...(toolCalls?.length && { tool_calls: toolCalls }),
        });
      } else if (msg.role === "tool" && msg.toolResults) {
        for (const tr of msg.toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.toolCallId,
            content: tr.content,
          });
        }
      }
    }

    return result;
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}
