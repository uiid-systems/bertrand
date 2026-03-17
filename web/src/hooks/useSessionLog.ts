import { useQuery } from "@tanstack/react-query"
import { sessionQueries } from "@/api/queries"

export function useSessionLog(sessionName: string, enabled: boolean) {
  return useQuery({
    ...sessionQueries.log(sessionName),
    enabled,
  })
}
