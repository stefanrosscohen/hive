import express from "express";
import { Orchestrator, type TaskResult } from "./orchestrator/orchestrator.js";
import { Notifier } from "./reporting/notifier.js";
import { settings } from "./config/settings.js";

// In-memory task history for the API
const taskHistory: TaskResult[] = [];

export function startServer(
  orchestrator: Orchestrator,
  notifier: Notifier,
  port: number
): void {
  const app = express();
  app.use(express.json());

  // Track completed tasks
  orchestrator.on("completed", (result) => {
    taskHistory.unshift(result);
    if (taskHistory.length > 100) taskHistory.pop();
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Run a task
  app.post("/api/run", async (req, res) => {
    const { task, budget, model, repo } = req.body;

    if (!task) {
      res.status(400).json({ error: "task is required" });
      return;
    }

    const taskBudget = budget ?? settings.defaultBudget;
    const taskModel = model ?? settings.defaultModel;

    // Start task in background
    const resultPromise = orchestrator.runTask({
      task,
      budget: taskBudget,
      model: taskModel,
      repo,
    });

    // Return immediately with task acknowledgment
    const taskIds = orchestrator.getActiveTaskIds();
    res.json({
      message: "Task started",
      task,
      budget: taskBudget,
      model: taskModel,
      activeTasks: taskIds.length,
    });

    // The task will complete in the background and be tracked
    resultPromise.catch((err) => {
      console.error(`[API] Task error: ${err.message}`);
    });
  });

  // Run a task and wait for result
  app.post("/api/run/sync", async (req, res) => {
    const { task, budget, model, repo } = req.body;

    if (!task) {
      res.status(400).json({ error: "task is required" });
      return;
    }

    try {
      const result = await orchestrator.runTask({
        task,
        budget: budget ?? settings.defaultBudget,
        model: model ?? settings.defaultModel,
        repo,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get active tasks
  app.get("/api/status", (_req, res) => {
    const taskIds = orchestrator.getActiveTaskIds();
    const tasks = taskIds.map((id) => ({
      id,
      budget: orchestrator.getTaskBudget(id),
    }));
    res.json({ activeTasks: tasks, totalHistory: taskHistory.length });
  });

  // Get task history
  app.get("/api/history", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(taskHistory.slice(0, limit));
  });

  // Cancel a task
  app.post("/api/cancel/:taskId", (req, res) => {
    const cancelled = orchestrator.cancelTask(req.params.taskId);
    res.json({ cancelled });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`[API] HTTP server running on port ${port}`);
    console.log(`[API] Endpoints:`);
    console.log(`  POST /api/run        — Start a task (async)`);
    console.log(`  POST /api/run/sync   — Start a task (wait for result)`);
    console.log(`  GET  /api/status     — Active tasks`);
    console.log(`  GET  /api/history    — Completed tasks`);
    console.log(`  POST /api/cancel/:id — Cancel a task`);
    console.log(`  GET  /health         — Health check`);
  });
}
