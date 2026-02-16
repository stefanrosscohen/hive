#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { mkdirSync } from "fs";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { Notifier } from "./reporting/notifier.js";
import { settings, validateSettings } from "./config/settings.js";
import { createTelegramBot, startTelegramBot } from "./telegram/bot.js";
import { startServer } from "./server.js";

const program = new Command();

program
  .name("hive")
  .description("Autonomous AI agent swarm — budget-constrained, no permissions")
  .version("0.1.0");

program
  .command("run")
  .description("Run a task with the agent swarm")
  .argument("<task>", "Task description")
  .option("-b, --budget <amount>", "Dollar budget for the task", String(settings.defaultBudget))
  .option("-m, --model <model>", "LLM model to use", settings.defaultModel)
  .option("-r, --repo <owner/repo>", "GitHub repository for the task")
  .action(async (task: string, opts) => {
    const errors = validateSettings();
    if (errors.length) {
      console.error(chalk.red("Configuration errors:"));
      errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      process.exit(1);
    }

    mkdirSync(settings.workspaceDir, { recursive: true });

    const budget = parseFloat(opts.budget);
    const model = opts.model;

    console.log(chalk.bold.yellow("\n🐝 Hive Agent Swarm\n"));
    console.log(chalk.dim(`Task: ${task}`));
    console.log(chalk.dim(`Budget: $${budget.toFixed(2)}`));
    console.log(chalk.dim(`Model: ${model}`));
    console.log(chalk.dim(`Workspace: ${settings.workspaceDir}\n`));

    const orchestrator = new Orchestrator();
    const notifier = new Notifier();
    notifier.attach(orchestrator);

    // Live output
    const spinner = ora("Planning task...").start();

    orchestrator.on("agent_started", (id, name, subtask) => {
      spinner.text = `${chalk.cyan(name)} working: ${subtask.slice(0, 60)}...`;
    });

    orchestrator.on("agent_tool_call", (id, tool, args) => {
      spinner.text = `${chalk.magenta(tool)}(${JSON.stringify(args).slice(0, 60)})`;
    });

    orchestrator.on("cost_update", (spent, total) => {
      const pct = ((spent / total) * 100).toFixed(0);
      spinner.suffixText = chalk.dim(`$${spent.toFixed(4)} / $${total.toFixed(2)} (${pct}%)`);
    });

    orchestrator.on("agent_done", (result) => {
      spinner.succeed(
        `${chalk.cyan(result.name)} ${result.status} — $${result.totalCost.toFixed(4)}`
      );
      spinner.start("Continuing...");
    });

    try {
      const result = await orchestrator.runTask({ task, budget, model, repo: opts.repo });

      spinner.stop();

      console.log(chalk.bold("\n--- Result ---\n"));

      const statusColor = result.status === "completed" ? chalk.green : chalk.red;
      console.log(statusColor(`Status: ${result.status}`));
      console.log(chalk.dim(`Total cost: $${result.totalCost.toFixed(4)}`));
      console.log(chalk.dim(`Agents used: ${result.agentResults.length}`));
      console.log();
      console.log(result.output);
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start Hive in server mode (HTTP API + Telegram bot)")
  .option("-p, --port <port>", "HTTP port", String(settings.port))
  .action(async (opts) => {
    const errors = validateSettings();
    if (errors.length) {
      console.error(chalk.red("Configuration errors:"));
      errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      process.exit(1);
    }

    mkdirSync(settings.workspaceDir, { recursive: true });

    console.log(chalk.bold.yellow("\n🐝 Hive Agent Swarm — Server Mode\n"));

    const orchestrator = new Orchestrator();
    const notifier = new Notifier();
    notifier.attach(orchestrator);

    // Start HTTP API first (needed for health checks)
    const port = parseInt(opts.port);
    startServer(orchestrator, notifier, port);

    // Start Telegram bot (non-blocking)
    const bot = createTelegramBot(orchestrator, notifier);
    if (bot) {
      startTelegramBot(bot).catch((err) => {
        console.error(`[Telegram] Bot error: ${err.message}`);
      });
    }
  });

program
  .command("status")
  .description("Check status of running tasks")
  .action(async () => {
    // For now, hit the local server
    try {
      const resp = await fetch(`http://localhost:${settings.port}/api/status`);
      const data = await resp.json();
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log("Hive server not running. Start with: hive serve");
    }
  });

program.parse();
