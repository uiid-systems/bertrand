import { useMutation, useQueryClient } from "@tanstack/react-query"
import { startPreview, stopPreview } from "@/api/client"
import { worktreeKeys } from "@/api/queries"

export function useStartPreview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (branch: string) => {
      const { url } = await startPreview(branch)
      return url
    },
    onSuccess: (url) => {
      window.open(url, "_blank")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: worktreeKeys.all })
    },
  })
}

export function useStopPreview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: stopPreview,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: worktreeKeys.all })
    },
  })
}
