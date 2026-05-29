'use client';

import { useRef, useState } from 'react';
import { SupabaseImportModal } from '@/components/SupabaseImportModal';
import type { UserDefaultPreferences } from '@/lib/user-preferences';

export function AddDatabaseMenu({
  hasSavedToken,
  newDatabasePreferences,
}: {
  hasSavedToken: boolean;
  newDatabasePreferences: UserDefaultPreferences;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeMenu() {
    menuRef.current?.removeAttribute('open');
  }

  function openImport() {
    closeMenu();
    setImportOpen(true);
  }

  return (
    <>
      <details ref={menuRef} className="header-menu">
        <summary className="header-menu-trigger">Add database</summary>
        <div className="header-menu-panel" role="menu">
          <button type="button" role="menuitem" className="header-menu-item-stacked" onClick={openImport}>
            <span className="header-menu-item-label">Import from Supabase</span>
            {hasSavedToken && <span className="menu-badge">Token saved</span>}
          </button>
          <a href="#add-database" role="menuitem" className="header-menu-link" onClick={closeMenu}>
            Connection string…
          </a>
        </div>
      </details>

      <SupabaseImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        hasSavedToken={hasSavedToken}
        newDatabasePreferences={newDatabasePreferences}
      />
    </>
  );
}
