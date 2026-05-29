import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DatabaseCheckSection } from '@/components/DatabaseCheckSection';
import type { JobStatusRow } from '@/components/JobStatusPanel';
import { BloatStats } from '@/components/BloatStats';
import { DeleteDatabaseButton } from '@/components/DeleteDatabaseButton';
import { InstallPgstattuplePanel } from '@/components/InstallPgstattuplePanel';
import { PgstattupleWarning } from '@/components/PgstattupleWarning';
import { MetricsChart } from '@/components/MetricsChart';
import { SignOutButton } from '@/components/SignOutButton';
import { GlobalConfigurationPanel } from '@/components/GlobalConfigurationPanel';
import { IndexMaintenanceSection } from '@/components/IndexMaintenanceSection';
import { InvalidIndexesSection } from '@/components/InvalidIndexesSection';
import { UnusedIndexesSection } from '@/components/UnusedIndexesSection';
import { DatabaseSettingsPanel } from '@/components/DatabaseSettingsPanel';
import { MaintenanceConnectionPanel } from '@/components/MaintenanceConnectionPanel';
import type { PostgresGucParameter } from '@vacuumshift/shared';
import { maintenanceScheduleRowToDefaultSchedule } from '@/lib/default-schedules';
import { rowToDatabasePreferences } from '@/lib/database-preferences';
import {
  parseIndexMaintenanceEvents,
  type InvalidIndexRow,
  type UnusedIndexRow,
} from '@/lib/index-maintenance';
import { JobHistorySection, type JobHistoryRow } from '@/components/JobHistorySection';
import { TopBloatTable } from '@/components/TopBloatTable';
import {
  activeWindowEndFromSchedules,
  buildWindowEstimateContext,
} from '@/lib/window-estimates';
import type { ScheduleWindowSpec } from '@vacuumshift/shared';
import { latestBloatStats, metricsHaveReclaimable, metricsToChartPoints } from '@/lib/metrics';
import { needsPgstattupleWarning } from '@/lib/pgstattuple';
import { createClient } from '@/lib/supabase/server';
import { filterIndexRowsByExclude } from '@/lib/exclude-index-rows';

export const dynamic = 'force-dynamic';

export default async function DatabasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const { job: jobId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: db } = await supabase
    .from('monitored_databases')
    .select(
      `
      id,
      label,
      supabase_project_ref,
      supabase_monitoring_role,
      maintenance_connection_vault_id,
      connection_vault_id,
      pgstattuple_installed,
      index_bloat_estimated,
      paused,
      last_health_ok,
      last_health_error,
      last_health_at,
      database_preferences (*),
      database_metrics (
        captured_at,
        database_size_bytes,
        table_bloat_bytes,
        index_bloat_bytes,
        reclaimable_bytes,
        pgstattuple_installed
      ),
      maintenance_jobs (
        id,
        kind,
        status,
        started_at,
        finished_at,
        objects_completed,
        objects_queued,
        error_message,
        created_at
      )
    `
    )
    .eq('id', id)
    .single();

  if (!db) notFound();

  const { data: scheduleRows } = await supabase
    .from('maintenance_schedules')
    .select(
      `
      id,
      name,
      enabled,
      recurrence,
      timezone,
      window_start_time,
      window_end_time,
      window_duration_minutes,
      interval_count,
      interval_unit,
      days_of_week,
      day_of_week,
      day_of_month
    `
    )
    .eq('database_id', id)
    .order('created_at', { ascending: true });

  const { data: latestBloatCapture } = await supabase
    .from('bloat_objects')
    .select('captured_at')
    .eq('database_id', id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestBloatAt = latestBloatCapture?.captured_at;

  let bloatQuery = supabase
    .from('bloat_objects')
    .select(
      'id, kind, schema_name, object_name, bloat_bytes, bloat_pages, relation_bytes, parent_schema, parent_table, captured_at'
    )
    .eq('database_id', id)
    .in('kind', ['table', 'index'])
    .order('bloat_bytes', { ascending: false })
    .limit(15);
  if (latestBloatAt) {
    bloatQuery = bloatQuery.eq('captured_at', latestBloatAt);
  }
  const { data: bloat } = await bloatQuery;

  let invalidQuery = supabase
    .from('bloat_objects')
    .select(
      'id, schema_name, object_name, relation_bytes, parent_schema, parent_table, captured_at, meta'
    )
    .eq('database_id', id)
    .eq('kind', 'invalid_index')
    .order('relation_bytes', { ascending: false })
    .limit(50);
  if (latestBloatAt) {
    invalidQuery = invalidQuery.eq('captured_at', latestBloatAt);
  }
  const { data: invalidIndexes } = await invalidQuery;

  let unusedQuery = supabase
    .from('bloat_objects')
    .select(
      'id, schema_name, object_name, relation_bytes, parent_schema, parent_table, captured_at, meta'
    )
    .eq('database_id', id)
    .eq('kind', 'unused_index')
    .order('relation_bytes', { ascending: false })
    .limit(100);
  if (latestBloatAt) {
    unusedQuery = unusedQuery.eq('captured_at', latestBloatAt);
  }
  const { data: unusedIndexes } = await unusedQuery;

  const { data: indexMaintenanceRow } = await supabase
    .from('autovacuum_settings')
    .select('captured_at, settings')
    .eq('database_id', id)
    .eq('scope', 'index_maintenance')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: jobHistory } = await supabase
    .from('maintenance_jobs')
    .select(
      `
      id,
      kind,
      status,
      started_at,
      finished_at,
      objects_completed,
      objects_queued,
      cleanup_rate_pages_per_sec,
      estimated_objects_completable,
      error_message,
      created_at,
      maintenance_operations (
        id,
        kind,
        schema_name,
        object_name,
        operation,
        status,
        duration_ms,
        bloat_pages_before,
        bloat_pages_after,
        pages_reclaimed,
        cleanup_rate_pages_per_sec,
        error_message,
        sort_order
      )
    `
    )
    .eq('database_id', id)
    .order('created_at', { ascending: false })
    .limit(25);

  const { data: autovacuumGlobal } = await supabase
    .from('autovacuum_settings')
    .select('captured_at, settings')
    .eq('database_id', id)
    .eq('scope', 'global')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const metrics = (db.database_metrics ?? []).sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
  );
  const chartData = metricsToChartPoints(metrics);
  const latestStats = latestBloatStats(metrics[metrics.length - 1]);

  const jobs = ((jobHistory?.length ? jobHistory : db.maintenance_jobs) ?? []).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ) as unknown as JobHistoryRow[];

  const initialJobs = jobs.filter((j) => j.kind === 'initial');
  const maintenanceJobs = jobs.filter((j) => j.kind === 'manual' || j.kind === 'scheduled');

  const panelCheckJob: JobStatusRow | null = (() => {
    if (jobId) {
      const match = jobs.find((j) => j.id === jobId);
      if (match?.kind === 'initial') return match as JobStatusRow;
    }
    const active = initialJobs.find(
      (j) => j.status === 'pending' || j.status === 'running'
    );
    if (active) return active as JobStatusRow;
    if (metrics.length > 0) return null;
    return (initialJobs[0] as JobStatusRow | undefined) ?? null;
  })();

  const panelMaintenanceJob: JobStatusRow | null = (() => {
    if (jobId) {
      const match = jobs.find((j) => j.id === jobId);
      if (match?.kind === 'manual' || match?.kind === 'scheduled') {
        return match as JobStatusRow;
      }
    }
    const active = maintenanceJobs.find(
      (j) => j.status === 'pending' || j.status === 'running'
    );
    if (active) return active as JobStatusRow;
    return (maintenanceJobs[0] as JobStatusRow | undefined) ?? null;
  })();

  const checkInProgress = initialJobs.some(
    (j) => j.status === 'pending' || j.status === 'running'
  );
  const maintenanceInProgress = maintenanceJobs.some(
    (j) => j.status === 'pending' || j.status === 'running'
  );
  const hasBloatSnapshot = Boolean(latestBloatAt);

  const prefs = Array.isArray(db.database_preferences)
    ? db.database_preferences[0]
    : db.database_preferences;

  const scheduleSpecs: ScheduleWindowSpec[] = (scheduleRows ?? []).map((row) => {
    const s = maintenanceScheduleRowToDefaultSchedule({
      ...row,
      interval_unit: row.interval_unit as 'day' | 'week' | 'month' | null,
    });
    return {
      enabled: s.enabled,
      interval_count: s.interval_count,
      interval_unit: s.interval_unit,
      days_of_week: s.days_of_week,
      day_of_month: s.day_of_month,
      window_start_time: s.window_start_time,
      window_end_time: s.window_end_time,
      timezone: s.timezone,
    };
  });

  const activeWindowEnd = activeWindowEndFromSchedules(scheduleSpecs);
  const rateJob = maintenanceJobs.find(
    (j) => j.cleanup_rate_pages_per_sec != null && Number(j.cleanup_rate_pages_per_sec) > 0
  );
  const dbPrefs = prefs ? rowToDatabasePreferences(prefs) : null;
  const excludePatterns = dbPrefs?.exclude_patterns ?? [];

  const filteredUnusedIndexes = filterIndexRowsByExclude(
    (unusedIndexes ?? []) as UnusedIndexRow[],
    excludePatterns
  );
  const filteredInvalidIndexes = filterIndexRowsByExclude(
    (invalidIndexes ?? []) as InvalidIndexRow[],
    excludePatterns
  );
  const windowEstimate =
    dbPrefs && bloat?.length
      ? buildWindowEstimateContext({
          bloatRows: bloat,
          prefs: dbPrefs,
          activeWindowEnd,
          cleanupRatePagesPerSec: rateJob?.cleanup_rate_pages_per_sec
            ? Number(rateJob.cleanup_rate_pages_per_sec)
            : null,
        })
      : null;

  const databaseSchedules = (scheduleRows ?? []).map((row) =>
    maintenanceScheduleRowToDefaultSchedule({
      ...row,
      interval_unit: row.interval_unit as 'day' | 'week' | 'month' | null,
    })
  );
  const globalParameters = (
    autovacuumGlobal?.settings as { parameters?: PostgresGucParameter[] } | null
  )?.parameters;

  const indexMaintenanceEvents = parseIndexMaintenanceEvents(
    indexMaintenanceRow?.settings
  );

  return (
    <main>
      <header>
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <Link href="/">← Databases</Link>
          </p>
          <h1 className="title-with-warning">
            {db.label}
            {needsPgstattupleWarning(db.pgstattuple_installed) && (
              <PgstattupleWarning indexBloatEstimated={db.index_bloat_estimated} />
            )}
          </h1>
        </div>
        <SignOutButton />
      </header>

      <DatabaseCheckSection
        databaseId={id}
        initialCheckJob={panelCheckJob}
        initialMaintenanceJob={panelMaintenanceJob}
        hideCheckWhenComplete={metrics.length > 0}
        paused={db.paused}
        checkInProgress={checkInProgress}
        maintenanceInProgress={maintenanceInProgress}
        hasBloatSnapshot={hasBloatSnapshot}
      />

      {needsPgstattupleWarning(db.pgstattuple_installed) && (
        <InstallPgstattuplePanel
          databaseId={id}
          supabaseProjectRef={db.supabase_project_ref}
        />
      )}

      <div className="card section">
        <h2>Size &amp; Bloat Over Time</h2>
        {latestStats && (
          <BloatStats
            size={latestStats.size}
            tableBloat={latestStats.tableBloat}
            indexBloat={latestStats.indexBloat}
            reclaimable={latestStats.reclaimable}
          />
        )}
        <MetricsChart
          data={chartData}
          showReclaimable={metricsHaveReclaimable(metrics) || Boolean(db.pgstattuple_installed)}
        />
        {db.pgstattuple_installed && !metricsHaveReclaimable(metrics) && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Reclaimable appears on the chart after the next check with pgstattuple installed.
          </p>
        )}
      </div>

      <section className="section card">
        <h2>Top Bloat (Latest Check)</h2>
        <TopBloatTable
          rows={bloat ?? []}
          indexBloatEstimated={Boolean(db.index_bloat_estimated)}
          pgstattupleInstalled={db.pgstattuple_installed}
          estimate={windowEstimate}
        />
      </section>

      <InvalidIndexesSection invalidIndexes={filteredInvalidIndexes} />

      <UnusedIndexesSection unusedIndexes={filteredUnusedIndexes} />

      <IndexMaintenanceSection
        events={indexMaintenanceEvents}
        capturedAt={indexMaintenanceRow?.captured_at ?? null}
      />

      <details className="section card collapsible-section">
        <summary>
          <h2>Maintenance Connection</h2>
        </summary>
        <MaintenanceConnectionPanel
          databaseId={id}
          hasMaintenanceConnection={
            Boolean(db.maintenance_connection_vault_id) &&
            db.maintenance_connection_vault_id !== db.connection_vault_id
          }
          supabaseProjectRef={db.supabase_project_ref}
          monitoringRole={db.supabase_monitoring_role}
        />
      </details>

      {prefs && (
        <DatabaseSettingsPanel
          databaseId={id}
          initialPreferences={rowToDatabasePreferences(prefs)}
          initialSchedules={databaseSchedules}
        />
      )}

      <GlobalConfigurationPanel
        key={`${id}:${autovacuumGlobal?.captured_at ?? 'none'}`}
        databaseId={id}
        initialCapturedAt={autovacuumGlobal?.captured_at ?? null}
        initialParameters={globalParameters ?? []}
      />

      <section className="section card">
        <h2>Job History</h2>
        <JobHistorySection jobs={jobs} />
        {jobs.some((j) => j.error_message) && (
          <p className="error" style={{ marginTop: '0.75rem' }}>
            Latest error: {jobs.find((j) => j.error_message)?.error_message}
          </p>
        )}
      </section>

      <section className="section database-danger-zone">
        <DeleteDatabaseButton
          databaseId={id}
          label={db.label}
          supabaseProjectRef={db.supabase_project_ref}
          supabaseMonitoringRole={db.supabase_monitoring_role}
        />
      </section>
    </main>
  );
}
