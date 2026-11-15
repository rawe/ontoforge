import { Checkbox } from '@/components/ui/checkbox'
import type { DiagnosticsControl } from './useDiagnostics'

/** The "Show diagnostics" switch, for a chat that has one (`hasSwitch`). */
export function DiagnosticsSwitch({ diagnostics }: { diagnostics: DiagnosticsControl }) {
  if (!diagnostics.hasSwitch) return null
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-xs whitespace-nowrap"
      title="Ask for each answer's diagnostics (how long each step took and the tokens each model call used) and show them under the answer"
    >
      <Checkbox aria-label="Show diagnostics" checked={diagnostics.on} onCheckedChange={(value) => diagnostics.view.setOn(value === true)} />
      Show diagnostics
    </label>
  )
}
