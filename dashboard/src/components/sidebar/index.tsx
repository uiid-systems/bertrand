import { useEffect, useMemo, useRef, useState } from "react";

import { Input, Kbd } from "@uiid/design-system";
import { SearchIcon } from "@uiid/icons";

import { useAllSessions, useSessions } from "../../lib/use-sessions";

import { matchesQuery, selectLiveSessions, selectSessions } from "./sidebar.utils";

import { LiveZone } from "./subcomponents/live-zone";
import { SessionsZone } from "./subcomponents/sessions-zone";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "./subcomponents/sidebar-wrapper";

export type SidebarProps = {
  WrapperProps?: SidebarWrapperProps;
};

export const Sidebar = ({ WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Two reads off the same poll: the live zone always sees every session, the
  // zone below sees whatever the archived toggle admits.
  const allSessions = useAllSessions();
  const listedSessions = useSessions({ includeArchived });

  const q = query.trim().toLowerCase();

  // Search deliberately doesn't reach the live zone. That zone is a pinned
  // inbox — something blocked on you must not vanish because you typed a
  // filter for the list underneath it. The input sits below the zone, next to
  // the list it does narrow.
  const live = useMemo(() => selectLiveSessions(allSessions), [allSessions]);

  // A live session still has to be findable. The zone above won't narrow, so
  // while searching this zone carries live rows too — see `selectSessions`.
  const searching = q.length > 0;

  const sessions = useMemo(
    () =>
      selectSessions(
        listedSessions.filter((s) => matchesQuery(s, q)),
        { includeLive: searching },
      ),
    [listedSessions, q, searching],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarWrapper {...WrapperProps}>
      <LiveZone sessions={live} />

      {/* Matches slug, name, repo and branch. The repo switcher this replaced
          could only ever answer "which project" — one question, asked by
          picking from a list that had to be kept correct by hand. */}
      <Input
        ref={inputRef}
        placeholder="Search sessions, repos, branches"
        before={<SearchIcon />}
        after={<Kbd hotkey={["meta", "k"]} />}
        size="small"
        fullwidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <SessionsZone
        sessions={sessions}
        searching={searching}
        includeArchived={includeArchived}
        onIncludeArchivedChange={setIncludeArchived}
        emptyLabel={
          query.trim() ? `No sessions match "${query}".` : "No sessions yet."
        }
      />
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
