import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'

/** A whole surface the signed-in user holds no role for. */
export function NoAccess({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-dvh items-center justify-center">
      <EmptyState
        icon={Lock}
        title={title}
        description={description}
        action={
          <Button asChild size="sm">
            <Link to="/">Go to ontologies</Link>
          </Button>
        }
      />
    </div>
  )
}
