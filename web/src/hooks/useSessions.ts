import { useQuery } from "@tanstack/react-query"
import { fetchSessions } from "@/api/client"

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
    refetchInterval: 2000,
  })
}
