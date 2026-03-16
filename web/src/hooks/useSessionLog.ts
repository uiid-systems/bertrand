import { useQuery } from "@tanstack/react-query"
import { fetchSessionLog } from "@/api/client"

export function useSessionLog(sessionName: string, enabled: boolean) {
  return useQuery({
    queryKey: ["sessions", sessionName, "log"],
    queryFn: () => fetchSessionLog(sessionName),
    refetchInterval: 2000,
    enabled,
  })
}
