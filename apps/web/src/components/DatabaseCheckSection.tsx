'use client';

import { useState } from 'react';
import { JobStatusPanel, type JobStatusRow } from '@/components/JobStatusPanel';
import { createClient } from '@/lib/supabase/client';

const JOB_SELECT =
  'id, kind, status, error_message, created_at, started_at, finished_at, objects_queued, objects_completed';

export function DatabaseCheckSection({
  databaseId,
  initialCheckJob,
  initialMaintenanceJob,
  hideCheckWhenComplete,
  paused,
  checkInProgress,
  maintenanceInProgress,
  hasBloatSnapshot,
  onCheckCompleted,
  onMaintenanceCompleted,
}: {
  databaseId: string;
  initialCheckJob: JobStatusRow | null;
  initialMaintenanceJob: JobStatusRow | null;
  hideCheckWhenComplete: boolean;
  paused: boolean;
  checkInProgress: boolean;
  maintenanceInProgress: boolean;
  hasBloatSnapshot: boolean;
  onCheckCompleted?: () => void;
  onMaintenanceCompleted?: () => void;
}) {
  const [checkOverride, setCheckOverride] = useState<JobStatusRow | null>(null);
  const [maintenanceOverride, setMaintenanceOverride] = useState<JobStatusRow | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

  const checkJob = checkOverride ?? initialCheckJob;
  const maintenanceJob = maintenanceOverride ?? initialMaintenanceJob;

  const checkActive = Boolean(
    checkJob && (checkJob.status === 'pending' || checkJob.status === 'running')
  );
  const maintenanceActive = Boolean(
    maintenanceJob &&
      (maintenanceJob.status === 'pending' || maintenanceJob.status === 'running')
  );
  const anyActive = checkInProgress || maintenanceInProgress || checkActive || maintenanceActive;

  async function queueJob(
    rpc: 'queue_initial_check' | 'queue_manual_maintenance',
    setOverride: (job: JobStatusRow | null) => void,
    setError: (msg: string | null) => void,
    setLoading: (v: boolean) => void,
    errorLabel: string
  ) {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: jobId, error: rpcError } = await supabase.rpc(rpc, {
        p_database_id: databaseId,
      });
      if (rpcError) throw rpcError;
      if (!jobId) throw new Error('No job id returned');

      const { data: row, error: fetchError } = await supabase
        .from('maintenance_jobs')
        .select(JOB_SELECT)
        .eq('id', jobId)
        .single();
      if (fetchError || !row) throw fetchError ?? new Error('Could not load queued job');

      setOverride(row as JobStatusRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : errorLabel);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="check-section">
      <div className="check-toolbar">
        <button
          type="button"
          className="secondary"
          disabled={paused || anyActive || checkLoading}
          onClick={() =>
            void queueJob(
              'queue_initial_check',
              setCheckOverride,
              setCheckError,
              setCheckLoading,
              'Could not queue check'
            )
          }
        >
          {checkLoading ? 'Queuing…' : 'Run check'}
        </button>
        <button
          type="button"
          disabled={paused || anyActive || maintenanceLoading || !hasBloatSnapshot}
          onClick={() =>
            void queueJob(
              'queue_manual_maintenance',
              setMaintenanceOverride,
              setMaintenanceError,
              setMaintenanceLoading,
              'Could not queue maintenance'
            )
          }
        >
          {maintenanceLoading ? 'Queuing…' : 'Run maintenance now'}
        </button>
        {paused && <span className="muted">Unpause this database to run jobs.</span>}
        {!paused && anyActive && !checkLoading && !maintenanceLoading && (
          <span className="muted">A job is already queued or running.</span>
        )}
        {!paused && !hasBloatSnapshot && (
          <span className="muted">Run a check first to snapshot bloat candidates.</span>
        )}
        {checkError && (
          <p className="error" style={{ margin: 0 }}>
            {checkError}
          </p>
        )}
        {maintenanceError && (
          <p className="error" style={{ margin: 0 }}>
            {maintenanceError}
          </p>
        )}
      </div>
      <p className="muted check-section-hint">
        <strong>Run check</strong> refreshes size, bloat, and index stats.{' '}
        <strong>Run maintenance now</strong> vacuums/reindexes objects from the latest check
        using your preferences (4h window).
      </p>
      {checkJob && (
        <JobStatusPanel
          key={checkJob.id}
          initialJob={checkJob}
          hideWhenComplete={hideCheckWhenComplete}
          onJobChange={setCheckOverride}
          onCompleted={() => {
            setCheckOverride(null);
            onCheckCompleted?.();
          }}
          databaseId={databaseId}
        />
      )}
      {maintenanceJob && (
        <JobStatusPanel
          key={maintenanceJob.id}
          initialJob={maintenanceJob}
          onJobChange={setMaintenanceOverride}
          onCompleted={() => {
            setMaintenanceOverride(null);
            onMaintenanceCompleted?.();
          }}
          databaseId={databaseId}
        />
      )}
    </section>
  );
}
