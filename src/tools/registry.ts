import type { ToolDefinition } from "../providers/provider.js";

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool "${name}"`;
    }
    try {
      return await tool.execute(args);
    } catch (err: any) {
      return `Error executing ${name}: ${err.message}`;
    }
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}

/**
 * Create a fully loaded tool registry with all available tools.
 */
export async function createToolRegistry(workspaceDir: string): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  // Import and register all tools
  const { registerFileTools } = await import("./file.js");
  const { registerBashTool } = await import("./bash.js");
  const { registerGitTools } = await import("./git.js");
  const { registerGitHubTools } = await import("./github.js");
  const { registerWebTools } = await import("./web.js");

  registerFileTools(registry, workspaceDir);
  registerBashTool(registry, workspaceDir);
  registerGitTools(registry, workspaceDir);
  registerGitHubTools(registry);
  registerWebTools(registry);

  return registry;
}
