import { useState, useEffect, useRef } from "react"
import { useSessionStore } from "@/store/session-store"

export function SearchInput() {
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const [local, setLocal] = useState(searchQuery)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  function handleChange(value: string) {
    setLocal(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSearchQuery(value), 200)
  }

  function handleClear() {
    setLocal("")
    setSearchQuery("")
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="search sessions..."
        className="h-7 w-full rounded border border-border bg-transparent px-2 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {local && (
        <button
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
        >
          &times;
        </button>
      )}
    </div>
  )
}
