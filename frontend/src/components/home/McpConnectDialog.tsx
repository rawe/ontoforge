import type { ReactNode } from 'react'
import { ConnectPanel } from '@/components/connect/ConnectPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** "Connect AI clients" dialog around the lens's connect panel. */
export function McpConnectDialog({
  ontologyKey,
  lensKey,
  trigger,
}: {
  ontologyKey: string
  lensKey: string
  trigger: ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect AI clients</DialogTitle>
          <DialogDescription>
            Point Claude Code or Codex at this lens through OntoForge's MCP servers.
          </DialogDescription>
        </DialogHeader>
        <ConnectPanel ontologyKey={ontologyKey} lensKey={lensKey} />
      </DialogContent>
    </Dialog>
  )
}
