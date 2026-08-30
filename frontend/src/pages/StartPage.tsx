import { Logo } from '@/components/Logo'

/**
 * `/` — the server-level entry point. Plain placeholder: the ontology
 * start page (cards, create, rename, delete) lands in a later slice.
 * `/` never auto-resumes into a workbench.
 */
export function StartPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
      <Logo className="size-14 rounded-2xl shadow-lg shadow-primary/10" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">OntoForge</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Ontologies</p>
      </div>
    </div>
  )
}
