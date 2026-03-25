import { useState, useEffect, useRef } from "react";

import { Input } from "@uiid/forms";

import { useSessionStore } from "@/store/session-store";

export function SearchInput() {
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);
  const [local, setLocal] = useState(searchQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  function handleChange(value: string) {
    setLocal(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSearchQuery(value), 200);
  }

  return (
    <Input
      value={local}
      onValueChange={(value) => handleChange(value)}
      placeholder="Search sessions"
      size="small"
    />
  );
}
