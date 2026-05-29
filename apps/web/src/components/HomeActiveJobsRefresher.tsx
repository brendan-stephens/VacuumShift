'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { logClientFetchError } from '@/lib/fetch-errors';

const POLL_MS = 3_000;

/**
 * Refreshes the home page while initial/maintenance jobs are in flight.
 * Server-rendered cards do not update on their own after import.
 */
export function HomeActiveJobsRefresher({ databaseIds }: { databaseIds: string[] }) {
  const router = useRouter();
  const activeCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!databaseIds.length) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('maintenance_jobs')
          .select('id')
          .in('database_id', databaseIds)
          .in('status', ['pending', 'running']);

        if (cancelled || error) {
          if (error) console.error('home job poll', error);
          return;
        }

        const active = data?.length ?? 0;
        if (activeCountRef.current !== active) {
          activeCountRef.current = active;
          router.refresh();
        }
      } catch (err) {
        logClientFetchError('home job poll', err);
      }
    };

    void tick();
    const intervalId = setInterval(() => void tick(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [databaseIds, router]);

  return null;
}
