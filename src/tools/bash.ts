import { execSync, spawn } from "child_process";
import type { ToolRegistry } from "./registry.js";

export function registerBashTool(registry: ToolRegistry, workspaceDir: string): void {
  registry.register({
    definition: {
      name: "bash",
      description:
        "Execute a shell command. Runs in the workspace directory. No restrictions — full system access. " +
        "Use for: running tests, installing packages, building projects, curl, etc.",
      parameters: {
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 60000)",
          },
        },
        required: ["command"],
      },
    },
    execute: async (args) => {
      const command = args.command as string;
      const timeout = (args.timeout as number) ?? 60_000;

      try {
        const output = execSync(command, {
          cwd: workspaceDir,
          timeout,
          maxBuffer: 1024 * 1024 * 10, // 10MB
          encoding: "utf-8",
          env: { ...process.env },
          shell: "/bin/bash",
        });
        const trimmed = output.trim();
        if (trimmed.length > 20_000) {
          return trimmed.slice(0, 10_000) + "\n...[truncated]...\n" + trimmed.slice(-10_000);
        }
        return trimmed || "(no output)";
      } catch (err: any) {
        const stderr = err.stderr?.toString() ?? "";
        const stdout = err.stdout?.toString() ?? "";
        return `Exit code: ${err.status ?? "unknown"}\nstdout: ${stdout.slice(0, 5000)}\nstderr: ${stderr.slice(0, 5000)}`;
      }
    },
  });

  registry.register({
    definition: {
      name: "bash_background",
      description:
        "Start a long-running background process (e.g., dev server). Returns the PID. " +
        "Output is not captured — use for processes that run indefinitely.",
      parameters: {
        properties: {
          command: { type: "string", description: "Shell command to run in background" },
        },
        required: ["command"],
      },
    },
    execute: async (args) => {
      const child = spawn(args.command as string, {
        cwd: workspaceDir,
        shell: "/bin/bash",
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
      return `Background process started with PID ${child.pid}`;
    },
  });
}
