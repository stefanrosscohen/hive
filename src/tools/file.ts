import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { resolve, dirname, relative, join } from "path";
import { glob } from "glob";
import type { ToolRegistry } from "./registry.js";

export function registerFileTools(registry: ToolRegistry, workspaceDir: string): void {
  registry.register({
    definition: {
      name: "read_file",
      description: "Read the contents of a file. Returns the full text content.",
      parameters: {
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const filePath = resolvePath(args.path as string, workspaceDir);
      if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;
      return readFileSync(filePath, "utf-8");
    },
  });

  registry.register({
    definition: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed. Overwrites existing content.",
      parameters: {
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
    execute: async (args) => {
      const filePath = resolvePath(args.path as string, workspaceDir);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, args.content as string, "utf-8");
      return `Written ${(args.content as string).length} bytes to ${filePath}`;
    },
  });

  registry.register({
    definition: {
      name: "edit_file",
      description: "Replace a specific string in a file with new content. The old_string must match exactly.",
      parameters: {
        properties: {
          path: { type: "string", description: "File path" },
          old_string: { type: "string", description: "Exact string to find and replace" },
          new_string: { type: "string", description: "Replacement string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    execute: async (args) => {
      const filePath = resolvePath(args.path as string, workspaceDir);
      if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;
      const content = readFileSync(filePath, "utf-8");
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      if (!content.includes(oldStr)) {
        return `Error: old_string not found in file. File content:\n${content.slice(0, 500)}...`;
      }
      const updated = content.replace(oldStr, newStr);
      writeFileSync(filePath, updated, "utf-8");
      return `Edited ${filePath}`;
    },
  });

  registry.register({
    definition: {
      name: "list_files",
      description: "List files matching a glob pattern in the workspace.",
      parameters: {
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts', 'src/**')" },
          path: { type: "string", description: "Base directory (default: workspace root)" },
        },
        required: ["pattern"],
      },
    },
    execute: async (args) => {
      const basePath = resolvePath((args.path as string) ?? ".", workspaceDir);
      const files = await glob(args.pattern as string, { cwd: basePath });
      if (files.length === 0) return "No files found";
      return files.slice(0, 200).join("\n");
    },
  });

  registry.register({
    definition: {
      name: "search_files",
      description: "Search for a regex pattern in files. Returns matching lines with file paths.",
      parameters: {
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory to search in (default: workspace root)" },
          glob_pattern: { type: "string", description: "File glob filter (e.g., '*.ts')" },
        },
        required: ["pattern"],
      },
    },
    execute: async (args) => {
      const searchDir = resolvePath((args.path as string) ?? ".", workspaceDir);
      const filePattern = (args.glob_pattern as string) ?? "**/*";
      const regex = new RegExp(args.pattern as string, "gm");

      const files = await glob(filePattern, { cwd: searchDir, nodir: true });
      const results: string[] = [];

      for (const file of files.slice(0, 100)) {
        try {
          const fullPath = join(searchDir, file);
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
              regex.lastIndex = 0;
            }
          }
        } catch {
          // skip binary files
        }
        if (results.length >= 50) break;
      }

      return results.length > 0 ? results.join("\n") : "No matches found";
    },
  });

  registry.register({
    definition: {
      name: "delete_file",
      description: "Delete a file.",
      parameters: {
        properties: {
          path: { type: "string", description: "File path to delete" },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const filePath = resolvePath(args.path as string, workspaceDir);
      if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;
      unlinkSync(filePath);
      return `Deleted ${filePath}`;
    },
  });
}

function resolvePath(p: string, workspaceDir: string): string {
  if (p.startsWith("/")) return p;
  return resolve(workspaceDir, p);
}
