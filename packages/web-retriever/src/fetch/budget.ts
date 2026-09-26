/**
 * fetch/budget.ts
 *
 * Shared, hard request budget.
 *
 * §70 of the spec — "No network operation may start unless the request budget
 * has a token available."  This module makes that invariant enforced at the
 * call-site rather than relying on manual counter increments scattered across
 * the pipeline.
 *
 * A single RequestBudget instance is created per retrieve() call and passed
 * into every subsystem that performs HTTP I/O (robots, sitemap, page fetches).
 * This makes it impossible for future code to accidentally violate the budget.
 */

export type BudgetConsumer =
  | "robots"
  | "sitemap"
  | "page"
  | "redirect"
  | "feed";

export class RequestBudget {
  private used = 0;

  constructor(private readonly max: number) {}

  /**
   * Returns true and increments the counter if a token is available.
   * Returns false when the budget is exhausted.
   *
   * Callers MUST check the return value and skip the I/O when false.
   */
  tryConsume(_consumer: BudgetConsumer): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }

  /** Current number of HTTP requests consumed. */
  get count(): number {
    return this.used;
  }

  /** Whether the budget has been fully spent. */
  get exhausted(): boolean {
    return this.used >= this.max;
  }

  /** Remaining tokens. */
  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }
}
