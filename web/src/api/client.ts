import type { Session, TypedEvent } from "@/lib/types"

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json()
  }
  return undefined as T
}

export function fetchSessions(): Promise<Session[]> {
  return apiFetch("/sessions")
}

export function fetchSessionLog(sessionName: string): Promise<TypedEvent[]> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionName)}/log`)
}

export function focusSession(sessionName: string): Promise<void> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionName)}/focus`, { method: "POST" })
}

export function archiveSession(sessionName: string): Promise<void> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionName)}/archive`, { method: "POST" })
}

export function deleteSession(sessionName: string): Promise<void> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionName)}/delete`, { method: "POST" })
}
