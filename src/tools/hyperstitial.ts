/**
 * Hyperstitial integration — conversational progress updates.
 *
 * Hyperstitial provides an MCP-based conversational interface.
 * In hosted mode, we connect via the MCP protocol.
 * For now, we provide a simple HTTP-based interface that can be
 * swapped for the MCP transport when available.
 */

export interface HyperstitialSession {
  id: string;
  messages: Array<{ role: "hive" | "hyperstitial"; content: string }>;
}

const sessions = new Map<string, HyperstitialSession>();

/**
 * Start a new Hyperstitial conversation for a task.
 */
export async function startSession(taskId: string): Promise<HyperstitialSession> {
  const session: HyperstitialSession = {
    id: taskId,
    messages: [],
  };
  sessions.set(taskId, session);

  // If MCP connection is available, use it
  // For now, log locally
  session.messages.push({
    role: "hive",
    content: `Task started: ${taskId}`,
  });

  return session;
}

/**
 * Send a progress update to a Hyperstitial session.
 */
export async function sendUpdate(
  taskId: string,
  message: string
): Promise<void> {
  const session = sessions.get(taskId);
  if (!session) return;

  session.messages.push({
    role: "hive",
    content: message,
  });

  // When MCP transport is available, this would send via:
  // mcp__hyperstitial__respond({ message })
  console.log(`[Hyperstitial:${taskId.slice(0, 8)}] ${message}`);
}

/**
 * Get the full transcript for a session.
 */
export function getTranscript(taskId: string): HyperstitialSession | null {
  return sessions.get(taskId) ?? null;
}

/**
 * Close a session.
 */
export function closeSession(taskId: string): void {
  sessions.delete(taskId);
}
