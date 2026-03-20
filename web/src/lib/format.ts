export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + "s"
  const m = Math.floor(s / 60)
  if (m < 60) return m + "m"
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? h + "h" + rm + "m" : h + "h"
}

export function formatAgo(ts: string): string {
  const d = Date.now() - new Date(ts).getTime()
  if (d < 60000) return "just now"
  if (d < 3600000) return Math.floor(d / 60000) + "m ago"
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago"
  return Math.floor(d / 86400000) + "d ago"
}
