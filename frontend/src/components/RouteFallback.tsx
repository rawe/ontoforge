import { Skeleton } from '@/components/ui/skeleton'

/** Suspense fallback shown while a lazy route chunk loads. */
export function RouteFallback() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="min-h-0 w-full flex-1" />
    </div>
  )
}
