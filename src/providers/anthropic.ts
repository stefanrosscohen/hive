import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, type Message, type ToolDefinition, type LLMResponse, type ToolCall } from "./provider.js";
import { calculateCost } from "../config/models.js";

export class AnthropicProvider extends LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    super();
    this.client = new Anthropic({ apiKey });
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = this.convertTools(tools);

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: 8192,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 && { tools: anthropicTools }),
      ...(systemPrompt && { system: systemPrompt }),
    };

    const response = await this.client.messages.create(params);

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments: b.input as Record<string, unknown>,
      }));

    const cost = calculateCost(
      model,
      response.usage.input_tokens,
      response.usage.output_tokens
    );

    this.emit("stream", { type: "done" });

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cost,
      },
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
    };
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (msg.images?.length) {
          const content: Anthropic.ContentBlockParam[] = [];
          for (const img of msg.images) {
            if (img.type === "base64") {
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mediaType,
                  data: img.data,
                },
              });
            } else {
              content.push({
                type: "image",
                source: {
                  type: "url",
                  url: img.data,
                },
              });
            }
          }
          if (msg.content) {
            content.push({ type: "text", text: msg.content });
          }
          result.push({ role: "user", content });
        } else {
          result.push({ role: "user", content: msg.content });
        }
      } else if (msg.role === "assistant") {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        result.push({ role: "assistant", content });
      } else if (msg.role === "tool" && msg.toolResults) {
        const content: Anthropic.ToolResultBlockParam[] = msg.toolResults.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.toolCallId,
          content: tr.content,
          ...(tr.isError && { is_error: true }),
        }));
        result.push({ role: "user", content });
      }
    }

    return result;
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        ...t.parameters,
      },
    }));
  }
}
