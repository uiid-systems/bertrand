import type { Session, SessionDigest, Worktree } from "@/lib/types"

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

export function fetchSessionLog(sessionName: string): Promise<SessionDigest> {
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

export function fetchWorktrees(): Promise<Worktree[]> {
  return apiFetch("/worktrees")
}

export function startPreview(
  branch: string,
): Promise<{ url: string }> {
  return apiFetch("/preview/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  })
}

export function stopPreview(branch: string): Promise<void> {
  return apiFetch("/preview/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  })
}
