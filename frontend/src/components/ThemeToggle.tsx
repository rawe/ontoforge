import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const ORDER = ['system', 'light', 'dark'] as const

/**
 * Cycles system → light → dark. Persisted by next-themes under `of.theme`
 * (configured in App), class strategy (`.dark` on <html>).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const current = (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as (typeof ORDER)[number])
    : 'system'
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : Monitor

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Theme: ${current}. Switch to ${next}.`}
          onClick={() => setTheme(next)}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Theme: <span className="font-medium">{current}</span>
      </TooltipContent>
    </Tooltip>
  )
}
