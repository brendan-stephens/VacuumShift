import { formatBytes } from '@/lib/format';

export function BloatStats({
  size,
  tableBloat,
  indexBloat,
  reclaimable,
}: {
  size: number;
  tableBloat: number;
  indexBloat: number;
  reclaimable?: number | null;
}) {
  const totalBloat = tableBloat + indexBloat;
  return (
    <div className="stat-row">
      <div className="stat">
        <span className="muted">Size</span>
        <strong>{formatBytes(size)}</strong>
      </div>
      <div className="stat">
        <span className="muted">Table bloat</span>
        <strong>{formatBytes(tableBloat)}</strong>
      </div>
      <div className="stat">
        <span className="muted">Index bloat</span>
        <strong>{formatBytes(indexBloat)}</strong>
      </div>
      <div className="stat">
        <span className="muted">Total bloat</span>
        <strong>{formatBytes(totalBloat)}</strong>
      </div>
      {reclaimable != null && (
        <div className="stat">
          <span className="muted" title="Heap free space (FULL/repack/cluster) + index bloat (reindex)">
            Reclaimable
          </span>
          <strong>{formatBytes(reclaimable)}</strong>
        </div>
      )}
    </div>
  );
}
