import type { Session, TypedEvent } from "@/lib/types"

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/sessions")
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function fetchSessionLog(
  project: string,
  session: string,
): Promise<TypedEvent[]> {
  const res = await fetch(`/sessions/${project}/${session}/log`)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function focusSession(
  project: string,
  session: string,
): Promise<void> {
  const res = await fetch(`/sessions/${project}/${session}/focus`, { method: "POST" })
  if (!res.ok) throw new Error(res.statusText)
}
