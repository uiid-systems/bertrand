import type { Session, TypedEvent } from "@/lib/types"

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function apiPost(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST" })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export function fetchSessions(): Promise<Session[]> {
  return apiFetch("/sessions")
}

export function fetchSessionLog(sessionName: string): Promise<TypedEvent[]> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionName)}/log`)
}

export function focusSession(sessionName: string): Promise<void> {
  return apiPost(`/sessions/${encodeURIComponent(sessionName)}/focus`)
}

export function archiveSession(sessionName: string): Promise<void> {
  return apiPost(`/sessions/${encodeURIComponent(sessionName)}/archive`)
}

export function deleteSession(sessionName: string): Promise<void> {
  return apiPost(`/sessions/${encodeURIComponent(sessionName)}/delete`)
}
