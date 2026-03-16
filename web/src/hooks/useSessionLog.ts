import { useQuery } from "@tanstack/react-query"
import { fetchSessionLog } from "@/api/client"

export function useSessionLog(
  project: string,
  session: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["sessions", project, session, "log"],
    queryFn: () => fetchSessionLog(project, session),
    refetchInterval: 2000,
    enabled,
  })
}
