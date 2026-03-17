import type { Session, TypedEvent } from "@/lib/types"

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/sessions")
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function fetchSessionLog(
  sessionName: string,
): Promise<TypedEvent[]> {
  const res = await fetch(`/sessions/${sessionName}/log`)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function focusSession(
  sessionName: string,
): Promise<void> {
  const res = await fetch(`/sessions/${sessionName}/focus`, { method: "POST" })
  if (!res.ok) throw new Error(res.statusText)
}
