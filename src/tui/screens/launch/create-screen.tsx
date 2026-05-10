import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Box, Text, TextInput, useInput, useTui } from "@orchetron/storm";

import { Picker, type PickerItem } from "@/tui/components/picker";
import { getAllGroups } from "@/db/queries/groups";
import { getAllSessions } from "@/db/queries/sessions";

interface CreateScreenProps {
  isFocused: boolean;
  onSubmit: (payload: { groupPath: string; slug: string }) => void;
  onQuit: () => void;
}

type Step = "group" | "slug";

export function CreateScreen({
  isFocused,
  onSubmit,
  onQuit,
}: CreateScreenProps) {
  const { clear } = useTui();
  const [step, setStep] = useState<Step>("group");
  const [groupPath, setGroupPath] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Storm's useCleanup only runs on app exit, not on React unmount, so the
  // slug TextInput's key listener stays subscribed even after we conditionally
  // render it out. Its onSubmit closure becomes stale (captures step="slug"
  // forever), and its internal value persists across "unmounts." A ref gives
  // the guard an always-fresh step to check.
  const stepRef = useRef(step);
  stepRef.current = step;

  // Storm leaves the terminal cursor at the previous TextInput's location
  // when the input unmounts mid-render. Force a full repaint after each
  // step transition so the cursor moves to the new focused input.
  useEffect(() => {
    clear();
  }, [step, clear]);

  // Only show groups that have at least one non-archived session.
  const groupItems = useMemo<PickerItem[]>(() => {
    const activeSessions = getAllSessions({ excludeArchived: true });
    const counts = new Map<string, number>();
    for (const s of activeSessions) {
      counts.set(s.groupPath, (counts.get(s.groupPath) ?? 0) + 1);
    }
    return getAllGroups()
      .filter((g) => counts.has(g.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((g) => ({
        value: g.path,
        label: g.path,
        color: g.color,
        meta: `${counts.get(g.path)}`,
      }));
  }, []);

  const handleGroupPicked = useCallback((value: string) => {
    setGroupPath(value);
    setError(null);
    setStep("slug");
  }, []);

  const handleSlugSubmit = useCallback(
    (value: string) => {
      if (stepRef.current !== "slug") return;
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Name cannot be empty.");
        return;
      }
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
        setError(
          "Name must start alphanumeric; letters, digits, dots, underscores, dashes only.",
        );
        return;
      }
      if (!groupPath) return;
      onSubmit({ groupPath, slug: trimmed });
    },
    [groupPath, onSubmit],
  );

  useInput(
    (e) => {
      if (!isFocused) return;
      if (e.key === "c" && e.ctrl) {
        onQuit();
        return;
      }
      if (e.key === "escape" && step === "slug") {
        setStep("group");
        setSlug("");
        setError(null);
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>New session</Text>
        <Text dim>·</Text>
        <Text dim>{stepLabel(step)}</Text>
      </Box>

      {groupPath && step === "slug" && (
        <Box flexDirection="row" gap={1}>
          <Text dim>Group:</Text>
          <Text color="green">{groupPath}</Text>
        </Box>
      )}

      {/*
        Both inputs stay mounted permanently to dodge Storm's orphan-listener
        problem: useCleanup runs on app exit, not on React unmount, so any
        TextInput that's been conditionally removed from JSX continues to
        receive keys with stale value/closure. Solution: keep both in the
        tree and toggle visibility via height=0 + overflow="hidden" (Storm's
        display:none doesn't propagate to children's layouts). isFocused
        gates the underlying useTextInputBehavior so the inactive input's
        handler returns early.
      */}
      <Box
        flexDirection="column"
        height={step === "group" ? undefined : 0}
        overflow="hidden"
      >
        <Picker
          mode="single"
          items={groupItems}
          isFocused={isFocused && step === "group"}
          placeholder="Pick or type a new group path…"
          onSubmit={handleGroupPicked}
          emptyHint="No active groups. Type a name to create one."
        />
      </Box>

      <Box
        flexDirection="column"
        gap={0}
        height={step === "slug" ? undefined : 0}
        overflow="hidden"
      >
        <Text dim>Name</Text>
        <Box
          borderStyle="round"
          borderColor={isFocused ? "green" : undefined}
          borderDimColor={!isFocused}
          paddingX={1}
        >
          <TextInput
            value={slug}
            onChange={(v) => {
              setSlug(v);
              setError(null);
            }}
            onSubmit={handleSlugSubmit}
            placeholder="fix-auth-bug"
            color="green"
            placeholderColor="gray"
            isFocused={isFocused && step === "slug"}
          />
        </Box>
      </Box>

      {error && <Text color="red">{error}</Text>}

      <Text dim>{footer(step)}</Text>
    </Box>
  );
}

function stepLabel(step: Step): string {
  return step === "group" ? "1/2 Group" : "2/2 Name";
}

function footer(step: Step): string {
  if (step === "group") {
    return "↑↓ navigate · enter pick · ctrl+c quit";
  }
  return "enter create · esc back · ctrl+c quit";
}
