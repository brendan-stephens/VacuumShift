'use client';

import { useState } from 'react';
import { formatExcludePatternsText, parseExcludePatternsText } from '@/lib/user-preferences';

/**
 * Local textarea state so typing does not remount the field. Parent forms remount via
 * their own `key` when server preferences reload (save / reset).
 */
export function ExcludePatternsField({
  patterns,
  onPatternsChange,
}: {
  patterns: string[];
  onPatternsChange: (patterns: string[]) => void;
}) {
  const [text, setText] = useState(() => formatExcludePatternsText(patterns));

  return (
    <label>
      Exclude patterns
      <textarea
        rows={3}
        placeholder={'^pg_.*\n^information_schema\\.'}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          onPatternsChange(parseExcludePatternsText(next));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.stopPropagation();
        }}
      />
      <span className="muted field-hint">
        One POSIX regex per line. Matched against index/table name, parent table (
        <code>schema.table</code>), and schema (e.g. <code>^auth\.</code> hides auth indexes
        and indexes on <code>auth.*</code> tables).
      </span>
    </label>
  );
}
