import { execSync } from "child_process";
import type { ToolRegistry } from "./registry.js";

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 30_000 }).trim();
  } catch (err: any) {
    return `git error: ${err.stderr?.toString() ?? err.message}`;
  }
}

export function registerGitTools(registry: ToolRegistry, workspaceDir: string): void {
  registry.register({
    definition: {
      name: "git_status",
      description: "Show git status of the workspace.",
      parameters: {
        properties: {
          path: { type: "string", description: "Repository path (default: workspace)" },
        },
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      return git("status --short", cwd);
    },
  });

  registry.register({
    definition: {
      name: "git_diff",
      description: "Show git diff (staged and unstaged changes).",
      parameters: {
        properties: {
          path: { type: "string", description: "Repository path" },
          staged: { type: "boolean", description: "Show only staged changes" },
        },
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      const flag = args.staged ? "--cached" : "";
      return git(`diff ${flag}`, cwd) || "(no changes)";
    },
  });

  registry.register({
    definition: {
      name: "git_commit",
      description: "Stage all changes and create a commit.",
      parameters: {
        properties: {
          message: { type: "string", description: "Commit message" },
          path: { type: "string", description: "Repository path" },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Specific files to stage (default: all)",
          },
        },
        required: ["message"],
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      const files = args.files as string[] | undefined;

      if (files?.length) {
        git(`add ${files.join(" ")}`, cwd);
      } else {
        git("add -A", cwd);
      }
      return git(`commit -m "${(args.message as string).replace(/"/g, '\\"')}"`, cwd);
    },
  });

  registry.register({
    definition: {
      name: "git_push",
      description: "Push commits to remote.",
      parameters: {
        properties: {
          path: { type: "string", description: "Repository path" },
          remote: { type: "string", description: "Remote name (default: origin)" },
          branch: { type: "string", description: "Branch name" },
          force: { type: "boolean", description: "Force push" },
        },
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      const remote = (args.remote as string) ?? "origin";
      const branch = (args.branch as string) ?? "";
      const force = args.force ? "--force" : "";
      return git(`push ${force} ${remote} ${branch}`.trim(), cwd);
    },
  });

  registry.register({
    definition: {
      name: "git_branch",
      description: "Create, switch, or list branches.",
      parameters: {
        properties: {
          action: {
            type: "string",
            enum: ["create", "switch", "list", "delete"],
            description: "Branch action",
          },
          name: { type: "string", description: "Branch name (for create/switch/delete)" },
          path: { type: "string", description: "Repository path" },
        },
        required: ["action"],
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      const name = args.name as string;

      switch (args.action) {
        case "create":
          return git(`checkout -b ${name}`, cwd);
        case "switch":
          return git(`checkout ${name}`, cwd);
        case "list":
          return git("branch -a", cwd);
        case "delete":
          return git(`branch -d ${name}`, cwd);
        default:
          return `Unknown action: ${args.action}`;
      }
    },
  });

  registry.register({
    definition: {
      name: "git_init",
      description: "Initialize a new git repository.",
      parameters: {
        properties: {
          path: { type: "string", description: "Directory to init (default: workspace)" },
        },
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      return git("init", cwd);
    },
  });

  registry.register({
    definition: {
      name: "git_log",
      description: "Show recent git commits.",
      parameters: {
        properties: {
          path: { type: "string", description: "Repository path" },
          count: { type: "number", description: "Number of commits (default: 10)" },
        },
      },
    },
    execute: async (args) => {
      const cwd = (args.path as string) ?? workspaceDir;
      const n = (args.count as number) ?? 10;
      return git(`log --oneline -${n}`, cwd);
    },
  });

  registry.register({
    definition: {
      name: "git_clone",
      description: "Clone a remote repository.",
      parameters: {
        properties: {
          url: { type: "string", description: "Repository URL" },
          path: { type: "string", description: "Local directory name" },
        },
        required: ["url"],
      },
    },
    execute: async (args) => {
      const target = (args.path as string) ?? "";
      return git(`clone ${args.url} ${target}`.trim(), workspaceDir);
    },
  });
}
