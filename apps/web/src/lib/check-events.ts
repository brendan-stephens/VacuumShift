export const CHECK_COMPLETED_EVENT = 'vacuumshift-check-completed';

export function dispatchCheckCompleted(databaseId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CHECK_COMPLETED_EVENT, { detail: { databaseId } })
  );
}
