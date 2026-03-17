import { queryOptions } from "@tanstack/react-query"
import { fetchSessions, fetchSessionLog } from "./client"

export const sessionKeys = {
  all: ["sessions"] as const,
  list: () => [...sessionKeys.all, "list"] as const,
  detail: (name: string) => [...sessionKeys.all, name] as const,
  log: (name: string) => [...sessionKeys.all, name, "log"] as const,
}

export const sessionQueries = {
  list: () =>
    queryOptions({
      queryKey: sessionKeys.list(),
      queryFn: fetchSessions,
      refetchInterval: 2000,
    }),

  log: (name: string) =>
    queryOptions({
      queryKey: sessionKeys.log(name),
      queryFn: () => fetchSessionLog(name),
      refetchInterval: 2000,
    }),
}
