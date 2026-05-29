/** Grace after window end before statement_timeout fires (enforce_time_window only). */
export const WINDOW_END_GRACE_MS = 30_000;

/**
 * Whether a new maintenance operation may start.
 * Default policy: only checked at the start of each table/index op; in-flight
 * work may continue past window_ends_at unless enforce_time_window is enabled.
 */
export function canStartOperation(windowEndsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() < windowEndsAt.getTime();
}

/**
 * statement_timeout for the upcoming operation (milliseconds).
 * - enforceTimeWindow false → 0 (disable timeout; avoids role/system caps)
 * - enforceTimeWindow true  → ms until window end + grace (min 1ms)
 */
export function operationStatementTimeoutMs(
  enforceTimeWindow: boolean,
  windowEndsAt: Date,
  now: Date = new Date()
): number {
  if (!enforceTimeWindow) return 0;
  const deadline = windowEndsAt.getTime() + WINDOW_END_GRACE_MS;
  return Math.max(1, deadline - now.getTime());
}

export function formatStatementTimeout(ms: number): string {
  if (ms <= 0) return '0';
  return `${Math.ceil(ms)}ms`;
}
