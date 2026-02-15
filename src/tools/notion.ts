import { Client } from "@notionhq/client";
import { settings } from "../config/settings.js";

let notion: Client | null = null;
let dashboardId: string | null = null;

function getNotion(): Client {
  if (!notion) {
    if (!settings.notionToken) throw new Error("NOTION_TOKEN not set");
    notion = new Client({ auth: settings.notionToken });
  }
  return notion;
}

/**
 * Ensure the Hive Dashboard database exists in Notion.
 * Creates it if NOTION_DASHBOARD_ID is not set.
 */
export async function ensureDashboard(parentPageId?: string): Promise<string> {
  if (dashboardId) return dashboardId;
  if (settings.notionDashboardId) {
    dashboardId = settings.notionDashboardId;
    return dashboardId;
  }

  // Create the dashboard database
  const client = getNotion();

  const params: any = {
    title: [{ type: "text", text: { content: "Hive Dashboard" } }],
    properties: {
      Task: { title: {} },
      Status: {
        select: {
          options: [
            { name: "Running", color: "blue" },
            { name: "Completed", color: "green" },
            { name: "Failed", color: "red" },
            { name: "Budget Exhausted", color: "orange" },
          ],
        },
      },
      Budget: { number: { format: "dollar" } },
      Spent: { number: { format: "dollar" } },
      Agents: { rich_text: {} },
      Model: { rich_text: {} },
      "Task ID": { rich_text: {} },
      Created: { date: {} },
    },
  };

  if (parentPageId) {
    params.parent = { type: "page_id", page_id: parentPageId };
  }

  const resp = await client.databases.create(params);
  dashboardId = resp.id;
  return dashboardId;
}

/**
 * Create a task entry in the Notion dashboard.
 */
export async function createTaskEntry(opts: {
  taskId: string;
  task: string;
  budget: number;
  model: string;
}): Promise<string> {
  const client = getNotion();
  const dbId = await ensureDashboard();

  const resp = await client.pages.create({
    parent: { database_id: dbId },
    properties: {
      Task: { title: [{ text: { content: opts.task.slice(0, 200) } }] },
      Status: { select: { name: "Running" } },
      Budget: { number: opts.budget },
      Spent: { number: 0 },
      Model: { rich_text: [{ text: { content: opts.model } }] },
      "Task ID": { rich_text: [{ text: { content: opts.taskId } }] },
      Created: { date: { start: new Date().toISOString() } },
    },
  });

  return resp.id;
}

/**
 * Update a task entry's status and spend.
 */
export async function updateTaskEntry(
  pageId: string,
  updates: {
    status?: "Running" | "Completed" | "Failed" | "Budget Exhausted";
    spent?: number;
    agents?: string;
    output?: string;
  }
): Promise<void> {
  const client = getNotion();
  const properties: Record<string, any> = {};

  if (updates.status) {
    properties.Status = { select: { name: updates.status } };
  }
  if (updates.spent !== undefined) {
    properties.Spent = { number: Math.round(updates.spent * 10000) / 10000 };
  }
  if (updates.agents) {
    properties.Agents = { rich_text: [{ text: { content: updates.agents.slice(0, 2000) } }] };
  }

  await client.pages.update({ page_id: pageId, properties });

  // Add output as a comment on the page
  if (updates.output) {
    await client.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ text: { content: updates.output.slice(0, 2000) } }],
    });
  }
}

/**
 * Add a progress comment to a task page.
 */
export async function addProgressComment(
  pageId: string,
  message: string
): Promise<void> {
  const client = getNotion();
  await client.comments.create({
    parent: { page_id: pageId },
    rich_text: [{ text: { content: message.slice(0, 2000) } }],
  });
}
