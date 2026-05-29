/** Network / navigation errors from fetch or Supabase client (often benign during refresh). */
export function isBenignClientFetchError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|aborted/i.test(message);
}

export function logClientFetchError(context: string, err: unknown): void {
  if (isBenignClientFetchError(err)) return;
  console.error(context, err);
}
