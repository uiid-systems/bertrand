import { useMutation, useQueryClient } from "@tanstack/react-query"
import { archiveSession, deleteSession } from "@/api/client"
import { sessionKeys } from "@/api/queries"

function bulkAction(fn: (name: string) => Promise<void>) {
  return async (names: string[]) => {
    const results = await Promise.allSettled(names.map(fn))
    const failures = results.filter((r) => r.status === "rejected")
    if (failures.length > 0) {
      throw new Error(`${failures.length}/${results.length} operations failed`)
    }
  }
}

export function useBulkArchive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkAction(archiveSession),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() })
    },
  })
}

export function useBulkDelete() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkAction(deleteSession),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() })
    },
  })
}
