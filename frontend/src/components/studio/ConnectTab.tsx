import { Anchor } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Lens } from '@/api/types'
import { ConnectPanel } from '@/components/connect/ConnectPanel'

/** Connect tab: AI-client configuration for this ontology and lens. */
export function ConnectTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  return (
    <div className="max-w-4xl rounded-xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Connect AI clients</h3>
        {/* Anchors are managed in the Workbench; the Studio only links there. */}
        <Link
          to={`/o/${ontologyKey}/w/${lens.key}/anchors`}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground hover:underline"
        >
          <Anchor className="size-3.5" />
          Manage anchors in the Workbench
        </Link>
      </div>
      <ConnectPanel ontologyKey={ontologyKey} lensKey={lens.key} />
    </div>
  )
}
