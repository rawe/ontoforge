import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import * as users from '@/api/users'
import type { Role } from '@/api/types'
import { invalidateAccess } from '@/components/access/access'
import { toastError } from '@/components/studio/lib'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROLE_LABELS } from '@/lib/access'

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === 'writer' || role === 'reader' ? 'outline' : 'secondary'} className="text-[11px]">
      {ROLE_LABELS[role]}
    </Badge>
  )
}

/** Removes one assignment; the server's refusal (e.g. the last Platform Administrator) shows as a toast. */
export function RemoveAssignmentButton({
  userId,
  assignmentId,
  label,
}: {
  userId: string
  assignmentId: string
  /** What is removed, for screen readers. */
  label: string
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => users.removeAssignment(userId, assignmentId),
    onSuccess: () => {
      invalidateAccess(queryClient)
      toast.success('Role removed')
    },
    onError: toastError,
  })
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Remove ${label}`}
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
    >
      <X className="size-3.5 text-muted-foreground" />
    </Button>
  )
}
