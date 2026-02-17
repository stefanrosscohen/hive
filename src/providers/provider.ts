import { EventEmitter } from "eventemitter3";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ImageAttachment {
  type: "base64" | "url";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64 string or URL
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ImageAttachment[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "budget";
}

export interface StreamEvent {
  type: "text" | "tool_call_start" | "tool_call_delta" | "done";
  text?: string;
  toolCall?: Partial<ToolCall>;
}

export interface LLMProviderEvents {
  stream: (event: StreamEvent) => void;
}

export abstract class LLMProvider extends EventEmitter<LLMProviderEvents> {
  abstract readonly name: string;

  abstract chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    systemPrompt?: string
  ): Promise<LLMResponse>;
}
