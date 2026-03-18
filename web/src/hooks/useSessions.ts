import { useQuery } from "@tanstack/react-query"
import { sessionQueries } from "@/api/queries"

export function useSessions() {
  return useQuery(sessionQueries.list())
}
