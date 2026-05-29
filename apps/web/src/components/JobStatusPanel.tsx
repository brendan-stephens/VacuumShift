'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { dispatchCheckCompleted } from '@/lib/check-events';
import { logClientFetchError } from '@/lib/fetch-errors';
import { formatTime } from '@/lib/format';

type JobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface JobStatusRow {
  id: string;
  kind: string;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  objects_queued: number;
  objects_completed: number;
}

const JOB_SELECT =
  'id, kind, status, error_message, created_at, started_at, finished_at, objects_queued, objects_completed';

const POLL_MS = 3_000;
const STALE_PENDING_MS = 30_000;

function isActiveStatus(status: JobStatus) {
  return status === 'pending' || status === 'running';
}

function panelTitle(kind: string): string {
  if (kind === 'scheduled') return 'Scheduled maintenance';
  if (kind === 'manual') return 'Maintenance run';
  return 'Bloat check';
}

function statusMessage(job: JobStatusRow, waitingMs: number): string {
  const progress =
    job.objects_queued > 0
      ? `${job.objects_completed} / ${job.objects_queued} objects`
      : null;

  if (job.kind === 'manual' || job.kind === 'scheduled') {
    switch (job.status) {
      case 'pending':
        if (waitingMs > STALE_PENDING_MS) {
          return 'Queued, but nothing has picked it up yet. Start the worker (see below).';
        }
        return job.kind === 'scheduled'
          ? 'Queued — worker will run a check, then maintenance in the window.'
          : 'Queued — worker will vacuum/reindex from the latest bloat snapshot.';
      case 'running':
        return progress
          ? `Running maintenance — ${progress}.`
          : job.kind === 'scheduled'
            ? 'Running bloat check, then maintenance in the window…'
            : 'Planning maintenance from the latest bloat snapshot…';
      case 'completed':
        return progress
          ? `Done — ${progress} processed.`
          : 'Done — no objects matched your size and exclude filters.';
      case 'partial':
        return (
          job.error_message ??
          (progress ? `Stopped early — ${progress}.` : 'Maintenance stopped before finishing.')
        );
      case 'failed':
        return job.error_message ?? 'Maintenance failed.';
      case 'cancelled':
        return job.error_message ?? 'Maintenance was cancelled.';
      default:
        return `Status: ${job.status}`;
    }
  }

  switch (job.status) {
    case 'pending':
      if (waitingMs > STALE_PENDING_MS) {
        return 'Queued, but nothing has picked it up yet. Start the worker (see below).';
      }
      return 'Queued — the worker usually picks this up within a few seconds.';
    case 'running':
      return 'Scanning tables and indexes for bloat…';
    case 'completed':
      return `Done — ${job.objects_completed} objects recorded. Charts below will update.`;
    case 'failed':
      return job.error_message ?? 'Check failed.';
    case 'cancelled':
      return job.error_message ?? 'Check was cancelled.';
    default:
      return `Status: ${job.status}`;
  }
}

export function JobStatusPanel({
  initialJob,
  hideWhenComplete = false,
  onCompleted,
  onJobChange,
  databaseId,
}: {
  initialJob: JobStatusRow | null;
  hideWhenComplete?: boolean;
  onCompleted?: () => void;
  /** Keep parent toolbar state in sync when polling updates status. */
  onJobChange?: (job: JobStatusRow) => void;
  databaseId?: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);

  // Polling external job state — appropriate use of useEffect (not derivable from props alone).
  const fetchJob = useCallback(async (jobId: string): Promise<JobStatusRow | null> => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('maintenance_jobs')
        .select(JOB_SELECT)
        .eq('id', jobId)
        .maybeSingle();
      if (error) {
        console.error('job poll', error);
        return null;
      }
      return data as JobStatusRow | null;
    } catch (err) {
      logClientFetchError('job poll', err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!job || !isActiveStatus(job.status)) return;

    let cancelled = false;
    const jobId = job.id;
    const intervalRef = { id: null as ReturnType<typeof setInterval> | null };

    const tick = async () => {
      try {
        const row = await fetchJob(jobId);
        if (cancelled || !row) return;
        setJob(row);
        onJobChange?.(row);

        const terminal =
          row.status === 'completed' ||
          row.status === 'partial' ||
          row.status === 'failed';
        if (!terminal) return;

        cancelled = true;
        if (intervalRef.id != null) clearInterval(intervalRef.id);

        onCompleted?.();
        if (databaseId && row.kind === 'initial' && row.status === 'completed') {
          dispatchCheckCompleted(databaseId);
        }
        window.setTimeout(() => router.refresh(), 0);
      } catch (err) {
        logClientFetchError('job poll tick', err);
      }
    };

    void tick();
    intervalRef.id = setInterval(() => void tick(), POLL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.id != null) clearInterval(intervalRef.id);
    };
  }, [job?.id, job?.status, fetchJob, router, onCompleted, onJobChange, databaseId]);

  if (!job) return null;
  if (hideWhenComplete && job.status === 'completed') return null;

  const waitingMs =
    job.status === 'pending' ? Date.now() - new Date(job.created_at).getTime() : 0;
  const isActive = isActiveStatus(job.status);
  const isStale = job.status === 'pending' && waitingMs > STALE_PENDING_MS;
  const panelClass = [
    'job-panel',
    isActive ? 'job-panel-active' : '',
    job.status === 'completed' ? 'job-panel-ok' : '',
    job.status === 'partial' ? 'job-panel-warn' : '',
    job.status === 'failed' || job.status === 'cancelled' ? 'job-panel-error' : '',
    isStale ? 'job-panel-warn' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={panelClass}>
      <div className="job-panel-header">
        <strong>{panelTitle(job.kind)}</strong>
        <span className={`badge ${job.status}`}>{job.status}</span>
      </div>
      <p className="job-panel-message">{statusMessage(job, waitingMs)}</p>
      <p className="muted job-panel-meta">
        Job {job.id.slice(0, 8)}… · created {formatTime(job.created_at)}
        {job.started_at && <> · started {formatTime(job.started_at)}</>}
        {job.finished_at && <> · finished {formatTime(job.finished_at)}</>}
      </p>
      {isStale && <pre className="job-panel-code">npm run dev:worker</pre>}
    </div>
  );
}
