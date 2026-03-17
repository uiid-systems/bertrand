import { useMutation, useQueryClient } from "@tanstack/react-query"
import { archiveSession, deleteSession } from "@/api/client"
import { sessionKeys } from "@/api/queries"

export function useBulkArchive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (names: string[]) =>
      Promise.allSettled(names.map(archiveSession)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}

export function useBulkDelete() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (names: string[]) =>
      Promise.allSettled(names.map(deleteSession)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all })
    },
  })
}
