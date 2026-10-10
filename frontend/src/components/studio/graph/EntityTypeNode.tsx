import { memo, useState } from 'react'
import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react'
import { ChevronDown, Plus, Tag } from 'lucide-react'
import type { EntityType, PropertyDefinition } from '@/api/types'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { NODE_WIDTH, TRUNCATE_AFTER } from './layout'

export interface EntityNodeData extends Record<string, unknown> {
  entityType: EntityType
  /** `undefined` while the list loads. */
  properties: PropertyDefinition[] | undefined
  collapsed: boolean
  onToggleCollapsed: () => void
  /** A property row was clicked: select the type with that property. */
  onSelectProperty: (propertyKey: string) => void
}

export type EntityFlowNode = Node<EntityNodeData, 'entityType'>
export type GhostFlowNode = Node<Record<string, never>, 'ghost'>

/** Height of the ghost node; the canvas centres it on the gesture point. */
export const GHOST_HEIGHT = 56

/**
 * Entity type node: type-colour accent, display name, mono key and a compact
 * property list (name property first, then by key), truncated after six rows.
 * The header chevron collapses the list to "N properties"; the flag is
 * stored per ontology (`graphStore.ts`). Hovering or selecting shows the "+"
 * handle that starts a connection; while one is dragged the whole card is
 * the drop target.
 */
function EntityTypeNodeInner({ id, data, selected }: NodeProps<EntityFlowNode>) {
  const [expanded, setExpanded] = useState(false)
  const connecting = useConnection((c) => c.inProgress)
  const dropTarget = useConnection((c) => c.inProgress && c.toNode?.id === id)
  const { entityType: et, properties, collapsed } = data
  const color = getTypeColor(et.key)

  const sorted = [...(properties ?? [])].sort((a, b) =>
    a.key === et.nameProperty ? -1 : b.key === et.nameProperty ? 1 : a.key.localeCompare(b.key),
  )
  const shown = expanded ? sorted : sorted.slice(0, TRUNCATE_AFTER)
  const hidden = sorted.length - shown.length
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    data.onToggleCollapsed()
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card shadow-sm transition-shadow',
        selected && 'ring-2 ring-primary/70',
        dropTarget && 'ring-2 ring-(--tc-emerald)',
      )}
      style={{ width: NODE_WIDTH, borderColor: color.borderVar }}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
        style={{ background: color.cssVar }}
        aria-hidden
      />

      <div className="flex items-start gap-1 pt-2 pr-1.5 pb-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', color.dot)} aria-hidden />
            <span className="truncate text-[13px] font-medium">{et.displayName}</span>
          </div>
          <div className="truncate pl-3.5 font-mono text-[10.5px] text-muted-foreground">{et.key}</div>
        </div>
        <button
          type="button"
          aria-label={collapsed ? 'Show properties' : 'Hide properties'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show properties (⇧H when selected)' : 'Hide properties (⇧H when selected)'}
          className="nodrag flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={toggle}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
        </button>
      </div>

      {collapsed ? (
        <button
          type="button"
          className="nodrag block w-full cursor-pointer border-t px-3 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
          onClick={toggle}
        >
          {properties === undefined
            ? '…'
            : `${sorted.length} ${sorted.length === 1 ? 'property' : 'properties'}`}
        </button>
      ) : (
        <div className="border-t px-1.5 py-1.5">
          {properties === undefined && <div className="mx-1.5 my-0.5 h-4 animate-pulse rounded bg-muted/60" />}
          {properties !== undefined && sorted.length === 0 && (
            <div className="h-[19px] px-1.5 text-[11px] leading-[19px] text-muted-foreground/70 italic">
              No properties
            </div>
          )}
          {shown.map((p) => (
            <button
              type="button"
              key={p.propertyId}
              title="Select with this property"
              className="flex h-[19px] w-full cursor-pointer items-center gap-1 rounded px-1.5 text-left text-[11px] hover:bg-muted/70"
              onClick={(e) => {
                e.stopPropagation()
                data.onSelectProperty(p.key)
              }}
            >
              <span className="truncate font-mono">{p.key}</span>
              {p.required && (
                <span className="text-(--tc-rose)" title="Required">
                  *
                </span>
              )}
              {p.key === et.nameProperty && (
                <Tag className="size-2.5 shrink-0 text-primary" aria-label="Name property" />
              )}
              <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">{p.dataType}</span>
            </button>
          ))}
          {sorted.length > TRUNCATE_AFTER && (
            <button
              type="button"
              className="nodrag mt-0.5 cursor-pointer px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(!expanded)
              }}
            >
              {hidden > 0 ? `+${hidden} more` : 'Show less'}
            </button>
          )}
        </div>
      )}

      {/* Drag from "+" onto a type, onto this type, or onto empty canvas. */}
      <Handle
        type="source"
        position={Position.Right}
        title="Drag to create a relation type"
        aria-label="Drag to create a relation type"
        className={cn(
          'flex! size-5! items-center! justify-center! rounded-full! border! border-border! bg-card! text-muted-foreground shadow-sm',
          'opacity-0 transition-opacity group-hover:opacity-100 hover:border-primary! hover:text-primary',
          selected && 'opacity-100',
          connecting && 'pointer-events-none opacity-0!',
        )}
      >
        <Plus className="pointer-events-none size-3" />
      </Handle>
      {/* Invisible; covers the whole card while a connection is dragged. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        className={connecting ? 'of-drop-target' : 'of-hidden-handle'}
      />
    </div>
  )
}

/** Where a new entity type will appear while it is being named. */
function GhostNodeInner() {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-primary/60 bg-card/60 text-[12px] text-primary"
      style={{ width: NODE_WIDTH, height: GHOST_HEIGHT }}
    >
      New entity type…
      {/* React Flow needs a handle on each end of the pending edge. */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="of-hidden-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="of-hidden-handle" />
    </div>
  )
}

export const EntityTypeNode = memo(EntityTypeNodeInner)
export const GhostNode = memo(GhostNodeInner)
