import type { Lens } from '@/api/types'
import { ConnectPanel } from '@/components/connect/ConnectPanel'

/** Connect tab: AI-client configuration for this ontology and lens. */
export function ConnectTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  return (
    <div className="max-w-4xl rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-[13px] font-semibold">Connect AI clients</h3>
      <ConnectPanel ontologyKey={ontologyKey} lensKey={lens.key} />
    </div>
  )
}
