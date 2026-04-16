import { useState, useCallback } from "react";

import { getAllSessions } from "@/db/queries/sessions";

export function useLaunchSessions() {
  const [cursor, setCursor] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const sessionRows = getAllSessions(
    showArchived ? undefined : { excludeArchived: true },
  );
  const selected = sessionRows[cursor];

  const toggleArchived = useCallback(() => {
    setShowArchived((s) => !s);
    setCursor(0);
  }, []);

  return {
    sessionRows,
    selected,
    cursor,
    setCursor,
    showArchived,
    toggleArchived,
    refresh,
  } as const;
}
