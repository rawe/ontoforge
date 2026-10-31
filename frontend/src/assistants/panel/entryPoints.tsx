import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Focus } from '../types'
import { useAssistantPanel } from './panelContext'

/** The layout's "AI" switch of the panel, in the sidebar's look; hidden without a language model. */
export function AssistantPanelToggle({ collapsed }: { collapsed: boolean }) {
  const { available, isOpen, toggle } = useAssistantPanel()
  if (!available) return null
  const label = isOpen ? 'Close the AI panel' : 'Open the AI panel'
  const button = (
    <button
      type="button"
      aria-pressed={isOpen}
      aria-label={collapsed ? label : undefined}
      data-testid="assistant-panel-toggle"
      onClick={toggle}
      className={cn(
        'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] font-medium',
        'text-sidebar-foreground/65 transition-colors duration-100',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        'focus-visible:outline-2 focus-visible:outline-ring/60',
        isOpen && 'bg-sidebar-accent text-sidebar-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <Sparkles className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">AI</span>}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** "Ask AI" about what it sits on: opens the panel with this focus; the input stays empty. Hidden without a language model. */
export function AskAboutButton({ focus, className }: { focus: Focus; className?: string }) {
  const { available, open } = useAssistantPanel()
  if (!available) return null
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn('text-muted-foreground', className)}
      title="Ask the AI about this"
      data-testid="assistant-ask-about"
      onClick={() => open({ focus })}
    >
      <Sparkles /> Ask AI
    </Button>
  )
}
