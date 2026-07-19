import { FileText, Pin } from 'lucide-react'
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { displayLabel } from '@/lib/displayLabel'
import { isDocumentStub } from '@/lib/documents'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { NODE_WIDTH, type EntityFlowNode } from './workingSet'

const handleClass =
  'size-2.5! rounded-full! border-2! border-background! bg-muted-foreground/60! opacity-40 transition-opacity group-hover:opacity-100'

/**
 * Canvas entity card: type-colored left border + dot, display label, type
 * name, document/pin indicators and a selected ring. Left handle receives connections,
 * right handle starts them (drag-connect). A `flashedAt` bump in data renders
 * a one-shot ring flash ("already on canvas").
 */
function EntityNodeInner({ data, selected }: NodeProps<EntityFlowNode>) {
  const color = getTypeColor(data.entity._entityTypeKey)
  const hasDocuments = Object.values(data.entity).some(isDocumentStub)

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card px-3 py-2 shadow-sm transition-[box-shadow,border-color]',
        selected && 'ring-2 ring-primary/70',
      )}
      style={{
        width: NODE_WIDTH,
        borderColor: color.borderVar,
        boxShadow: `inset 3px 0 0 ${color.cssVar}`,
      }}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: color.cssVar }}
          aria-hidden
        />
        <span className="truncate text-[10.5px] text-muted-foreground">
          {data.typeName}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {hasDocuments && (
            <FileText
              className="size-3 text-muted-foreground/70"
              aria-label="Has documents"
            />
          )}
          {data.pinned && (
            <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />
          )}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">
        {displayLabel(data.entity)}
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
      {data.flashedAt !== 0 && (
        <>
          {/* One-shot "already on canvas" flash: keyed by flashedAt so a new
              bump re-runs the fade-out animation; ends (and stays) invisible. */}
          <span
            key={data.flashedAt}
            className="pointer-events-none absolute -inset-1 rounded-[10px] ring-2 ring-primary/80 animate-[of-node-flash_0.9s_ease-out_forwards]"
            aria-hidden
          />
          <style>{'@keyframes of-node-flash{0%{opacity:1}70%{opacity:.9}100%{opacity:0}}'}</style>
        </>
      )}
    </div>
  )
}

export const EntityNode = memo(EntityNodeInner)
