export type JobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface JobSummary {
  kind: string;
  status: JobStatus;
  created_at: string;
}

export function isActiveJobStatus(status: string): boolean {
  return status === 'pending' || status === 'running';
}

/** Most recent job first; ignores older pending rows if a newer job finished. */
export function sortJobsNewestFirst<T extends { created_at: string }>(jobs: T[]): T[] {
  return [...jobs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function newestActiveJob<T extends JobSummary>(jobs: T[] | null | undefined): T | undefined {
  return sortJobsNewestFirst(jobs ?? []).find((j) => isActiveJobStatus(j.status));
}

export function newestJobOfKind<T extends JobSummary>(
  jobs: T[] | null | undefined,
  kind: string
): T | undefined {
  return sortJobsNewestFirst(jobs ?? []).find((j) => j.kind === kind);
}

/** Reset keyed job UI when the server points at a different job row. */
export function jobInstanceKey(job: JobSummary | null | undefined): string {
  return job?.id ?? '';
}
