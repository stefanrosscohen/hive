import "dotenv/config";
import { resolve } from "path";

export const settings = {
  // LLM
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5-20250929",
  defaultBudget: parseFloat(process.env.DEFAULT_BUDGET ?? "5.00"),

  // GitHub
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubUsername: process.env.GITHUB_USERNAME ?? "hive-agent-bot",

  // Notion
  notionToken: process.env.NOTION_TOKEN ?? "",
  notionDashboardId: process.env.NOTION_DASHBOARD_ID ?? "",

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramOwnerId: process.env.TELEGRAM_OWNER_ID ?? "",

  // Workspace
  workspaceDir: resolve(process.env.WORKSPACE_DIR ?? "./workspace"),

  // Server
  port: parseInt(process.env.PORT ?? "3000"),
} as const;

export function validateSettings(): string[] {
  const errors: string[] = [];
  if (!settings.anthropicApiKey && !settings.openaiApiKey) {
    errors.push("At least one LLM API key required (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
  }
  return errors;
}
