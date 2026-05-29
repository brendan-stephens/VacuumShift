import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BloatStats } from '@/components/BloatStats';
import { MetricsChart } from '@/components/MetricsChart';
import { RegisterForm } from '@/components/RegisterForm';
import { AddDatabaseMenu } from '@/components/AddDatabaseMenu';
import { PreferencesButton } from '@/components/PreferencesButton';
import { PgstattupleWarning } from '@/components/PgstattupleWarning';
import { SignOutButton } from '@/components/SignOutButton';
import { latestBloatStats, metricsHaveReclaimable, metricsToChartPoints } from '@/lib/metrics';
import { needsPgstattupleWarning } from '@/lib/pgstattuple';
import { rowToDefaultSchedule } from '@/lib/default-schedules';
import { mergeUserDefaultPreferences } from '@/lib/user-preferences';
import { createClient } from '@/lib/supabase/server';
import { HomeActiveJobsRefresher } from '@/components/HomeActiveJobsRefresher';
import { isActiveJobStatus, newestJobOfKind, newestActiveJob } from '@/lib/job-status';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: supabaseAccount } = await supabase
    .from('user_supabase_accounts')
    .select('user_id')
    .maybeSingle();

  const { data: userPrefsRow } = await supabase
    .from('user_default_preferences')
    .select(
      'min_table_size_mb, min_index_size_mb, table_vacuum_mode, index_reindex_mode, pause_between_ops_ms, exclude_patterns, enforce_time_window'
    )
    .maybeSingle();

  const userDefaults = mergeUserDefaultPreferences(userPrefsRow ?? undefined);

  const { data: scheduleRows } = await supabase
    .from('user_default_schedules')
    .select(
      'id, name, enabled, interval_count, interval_unit, days_of_week, day_of_month, window_start_time, window_end_time, timezone'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const userDefaultSchedules = (scheduleRows ?? []).map((row) =>
    rowToDefaultSchedule({
      ...row,
      interval_unit: row.interval_unit as 'day' | 'week' | 'month',
    })
  );

  const { data: databases, error: databasesError } = await supabase
    .from('monitored_databases')
    .select(
      `
      id,
      label,
      pgstattuple_installed,
      index_bloat_estimated,
      paused,
      last_health_ok,
      last_health_at,
      database_metrics (
        captured_at,
        database_size_bytes,
        table_bloat_bytes,
        index_bloat_bytes,
        reclaimable_bytes
      ),
      maintenance_jobs (
        kind,
        status,
        created_at
      )
    `
    )
    .order('created_at', { ascending: false });

  const allDatabaseIds = databases?.map((db) => db.id) ?? [];
  const anyActiveJob = databases?.some((db) => newestActiveJob(db.maintenance_jobs));

  return (
    <main>
      {anyActiveJob && <HomeActiveJobsRefresher databaseIds={allDatabaseIds} />}
      <header>
        <h1>VacuumShift</h1>
        <div className="header-actions">
          <PreferencesButton
            initialPreferences={userDefaults}
            initialSchedules={userDefaultSchedules}
          />
          <AddDatabaseMenu
            hasSavedToken={Boolean(supabaseAccount)}
            newDatabasePreferences={userDefaults}
          />
          <SignOutButton />
        </div>
      </header>

      {databasesError && (
        <p className="error" style={{ marginTop: '1rem' }}>
          Could not load databases: {databasesError.message}. Run{' '}
          <code>supabase db reset</code> if you recently pulled schema changes.
        </p>
      )}

      {!databasesError && !databases?.length ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No databases monitored yet.
        </p>
      ) : !databasesError && databases ? (
        <div className="card-grid" style={{ marginTop: '1.5rem' }}>
          {databases.map((db) => {
            const metrics = (db.database_metrics ?? []).sort(
              (a, b) =>
                new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
            );
            const chartData = metricsToChartPoints(metrics);
            const latest = metrics[metrics.length - 1];
            const stats = latestBloatStats(latest);
            const activeJob = newestActiveJob(db.maintenance_jobs);
            const initialJob = newestJobOfKind(db.maintenance_jobs, 'initial');

            return (
              <Link key={db.id} href={`/databases/${db.id}`} className="card database-card">
                <h2 className="title-with-warning" style={{ margin: 0 }}>
                  {db.label}
                  {needsPgstattupleWarning(db.pgstattuple_installed) && (
                    <PgstattupleWarning indexBloatEstimated={db.index_bloat_estimated} />
                  )}
                </h2>
                {activeJob && (
                  <span className="card-job-indicator" title={`${activeJob.kind} ${activeJob.status}`}>
                    <span className="card-job-dot" aria-hidden />
                    job running
                  </span>
                )}
                {initialJob && isActiveJobStatus(initialJob.status) && (
                  <span className={`badge ${initialJob.status}`}>
                    check {initialJob.status}
                  </span>
                )}
                {db.paused && <span className="badge">paused</span>}
                {db.last_health_ok === false && (
                  <span className="badge failed">unhealthy</span>
                )}
                {stats && (
                  <BloatStats
                    size={stats.size}
                    tableBloat={stats.tableBloat}
                    indexBloat={stats.indexBloat}
                    reclaimable={stats.reclaimable}
                  />
                )}
                <MetricsChart
                  data={chartData}
                  showReclaimable={metricsHaveReclaimable(metrics)}
                />
              </Link>
            );
          })}
        </div>
      ) : null}

      <RegisterForm newDatabasePreferences={userDefaults} />
    </main>
  );
}
