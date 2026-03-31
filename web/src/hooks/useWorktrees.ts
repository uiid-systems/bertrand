import { useQuery } from "@tanstack/react-query"
import { worktreeQueries } from "@/api/queries"

export function useWorktrees() {
  return useQuery(worktreeQueries.list())
}
