import type { Session, TypedEvent } from "@/lib/types"

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/sessions")
  return res.json()
}

export async function fetchSessionLog(
  project: string,
  session: string,
): Promise<TypedEvent[]> {
  const res = await fetch(`/sessions/${project}/${session}/log`)
  return res.json()
}

export async function focusSession(
  project: string,
  session: string,
): Promise<void> {
  await fetch(`/sessions/${project}/${session}/focus`, { method: "POST" })
}
