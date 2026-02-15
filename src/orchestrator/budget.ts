import { EventEmitter } from "eventemitter3";

export interface BudgetEvents {
  spend: (agentId: string, amount: number, total: number, remaining: number) => void;
  warning: (agentId: string, percentUsed: number) => void;
  exhausted: (agentId: string) => void;
}

export interface AgentBudget {
  agentId: string;
  allocated: number;
  spent: number;
}

export class BudgetManager extends EventEmitter<BudgetEvents> {
  private totalBudget: number;
  private totalSpent = 0;
  private agentBudgets = new Map<string, AgentBudget>();
  private reserve: number;

  constructor(totalBudget: number, reservePercent = 0.1) {
    super();
    this.totalBudget = totalBudget;
    this.reserve = totalBudget * reservePercent;
  }

  get spent(): number {
    return this.totalSpent;
  }

  get remaining(): number {
    return Math.max(0, this.totalBudget - this.totalSpent);
  }

  get budget(): number {
    return this.totalBudget;
  }

  /**
   * Allocate budget for an agent. Returns the allocated amount.
   */
  allocate(agentId: string, requested: number): number {
    const available = this.totalBudget - this.totalSpent - this.reserve;
    const allocated = Math.min(requested, Math.max(0, available));

    this.agentBudgets.set(agentId, {
      agentId,
      allocated,
      spent: 0,
    });

    return allocated;
  }

  /**
   * Record spend for an agent. Returns false if budget exceeded.
   */
  recordSpend(agentId: string, amount: number): boolean {
    this.totalSpent += amount;

    const agentBudget = this.agentBudgets.get(agentId);
    if (agentBudget) {
      agentBudget.spent += amount;
    }

    const remaining = this.totalBudget - this.totalSpent;
    this.emit("spend", agentId, amount, this.totalSpent, remaining);

    // Warnings at 50%, 80%, 90%
    const percentUsed = (this.totalSpent / this.totalBudget) * 100;
    if (percentUsed >= 90) {
      this.emit("warning", agentId, percentUsed);
    } else if (percentUsed >= 80) {
      this.emit("warning", agentId, percentUsed);
    }

    if (this.totalSpent >= this.totalBudget) {
      this.emit("exhausted", agentId);
      return false;
    }

    return true;
  }

  /**
   * Check if an agent can still spend.
   */
  canSpend(agentId: string): boolean {
    const agentBudget = this.agentBudgets.get(agentId);
    if (!agentBudget) return false;
    return agentBudget.spent < agentBudget.allocated && this.totalSpent < this.totalBudget;
  }

  /**
   * Release unspent budget back to the pool (when an agent finishes early).
   */
  release(agentId: string): number {
    const agentBudget = this.agentBudgets.get(agentId);
    if (!agentBudget) return 0;
    const unspent = agentBudget.allocated - agentBudget.spent;
    this.agentBudgets.delete(agentId);
    return unspent;
  }

  getSummary(): {
    total: number;
    spent: number;
    remaining: number;
    agents: AgentBudget[];
  } {
    return {
      total: this.totalBudget,
      spent: this.totalSpent,
      remaining: this.remaining,
      agents: Array.from(this.agentBudgets.values()),
    };
  }
}
