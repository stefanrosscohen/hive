import { Octokit } from "@octokit/rest";
import { settings } from "../config/settings.js";
import type { ToolRegistry } from "./registry.js";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: settings.githubToken });
  }
  return octokit;
}

export function registerGitHubTools(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: "github_create_repo",
      description: "Create a new GitHub repository.",
      parameters: {
        properties: {
          name: { type: "string", description: "Repository name" },
          description: { type: "string", description: "Repository description" },
          private: { type: "boolean", description: "Make private (default: false)" },
        },
        required: ["name"],
      },
    },
    execute: async (args) => {
      const resp = await getOctokit().repos.createForAuthenticatedUser({
        name: args.name as string,
        description: (args.description as string) ?? "",
        private: (args.private as boolean) ?? false,
        auto_init: true,
      });
      return `Created repo: ${resp.data.html_url}`;
    },
  });

  registry.register({
    definition: {
      name: "github_create_pr",
      description: "Create a pull request.",
      parameters: {
        properties: {
          owner: { type: "string", description: "Repo owner" },
          repo: { type: "string", description: "Repo name" },
          title: { type: "string", description: "PR title" },
          body: { type: "string", description: "PR body/description" },
          head: { type: "string", description: "Source branch" },
          base: { type: "string", description: "Target branch (default: main)" },
        },
        required: ["owner", "repo", "title", "head"],
      },
    },
    execute: async (args) => {
      const resp = await getOctokit().pulls.create({
        owner: args.owner as string,
        repo: args.repo as string,
        title: args.title as string,
        body: (args.body as string) ?? "",
        head: args.head as string,
        base: (args.base as string) ?? "main",
      });
      return `Created PR #${resp.data.number}: ${resp.data.html_url}`;
    },
  });

  registry.register({
    definition: {
      name: "github_create_issue",
      description: "Create a GitHub issue.",
      parameters: {
        properties: {
          owner: { type: "string", description: "Repo owner" },
          repo: { type: "string", description: "Repo name" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body" },
          labels: { type: "array", items: { type: "string" }, description: "Labels" },
        },
        required: ["owner", "repo", "title"],
      },
    },
    execute: async (args) => {
      const resp = await getOctokit().issues.create({
        owner: args.owner as string,
        repo: args.repo as string,
        title: args.title as string,
        body: (args.body as string) ?? "",
        labels: (args.labels as string[]) ?? [],
      });
      return `Created issue #${resp.data.number}: ${resp.data.html_url}`;
    },
  });

  registry.register({
    definition: {
      name: "github_list_issues",
      description: "List open issues for a repository.",
      parameters: {
        properties: {
          owner: { type: "string", description: "Repo owner" },
          repo: { type: "string", description: "Repo name" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state" },
        },
        required: ["owner", "repo"],
      },
    },
    execute: async (args) => {
      const resp = await getOctokit().issues.listForRepo({
        owner: args.owner as string,
        repo: args.repo as string,
        state: (args.state as "open" | "closed" | "all") ?? "open",
        per_page: 30,
      });
      return resp.data
        .map((i) => `#${i.number} [${i.state}] ${i.title}`)
        .join("\n") || "No issues found";
    },
  });

  registry.register({
    definition: {
      name: "github_get_issue",
      description: "Get details of a specific issue.",
      parameters: {
        properties: {
          owner: { type: "string", description: "Repo owner" },
          repo: { type: "string", description: "Repo name" },
          issue_number: { type: "number", description: "Issue number" },
        },
        required: ["owner", "repo", "issue_number"],
      },
    },
    execute: async (args) => {
      const resp = await getOctokit().issues.get({
        owner: args.owner as string,
        repo: args.repo as string,
        issue_number: args.issue_number as number,
      });
      const i = resp.data;
      return [
        `#${i.number}: ${i.title}`,
        `State: ${i.state}`,
        `Labels: ${i.labels.map((l: any) => (typeof l === "string" ? l : l.name)).join(", ")}`,
        `Body:\n${i.body ?? "(empty)"}`,
      ].join("\n");
    },
  });

  registry.register({
    definition: {
      name: "github_add_remote",
      description: "Configure git remote to use the Hive bot's GitHub credentials.",
      parameters: {
        properties: {
          owner: { type: "string", description: "Repo owner" },
          repo: { type: "string", description: "Repo name" },
          path: { type: "string", description: "Local repo path" },
        },
        required: ["owner", "repo", "path"],
      },
    },
    execute: async (args) => {
      const { execSync } = await import("child_process");
      const url = `https://${settings.githubUsername}:${settings.githubToken}@github.com/${args.owner}/${args.repo}.git`;
      try {
        execSync(`git remote set-url origin ${url}`, {
          cwd: args.path as string,
          encoding: "utf-8",
        });
        return `Remote origin set for ${args.owner}/${args.repo}`;
      } catch {
        execSync(`git remote add origin ${url}`, {
          cwd: args.path as string,
          encoding: "utf-8",
        });
        return `Remote origin added for ${args.owner}/${args.repo}`;
      }
    },
  });
}
