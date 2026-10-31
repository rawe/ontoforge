/**
 * The graph's docked inspector: the selected type's `TypeHeader` (panel),
 * `PropertiesEditor` (compact), its relation types and delete — the same
 * components as the classic type page. Not modal: the canvas stays usable
 * beside it.
 */

import { Box, PanelTop, Workflow, X } from 'lucide-react'
import { AskAboutButton } from '@/assistants'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DeleteTypeButton } from '../modeling/DeleteDialog'
import type { TypeRef } from '../modeling/deleteContext'
import { PropertiesEditor } from '../modeling/PropertiesEditor'
import { TypeHeader } from '../modeling/TypeHeader'
import { TypeRelations } from '../modeling/TypeRelations'
import { findTypeByKey, useModelSchema } from '../modeling/useModelSchema'
import { addRequestOf, openRequestOf, useSchemaWorkspace } from './workspaceContext'

export function Inspector() {
  const { ontologyKey, selection, propertyRequest, addPropertyRequest, select, switchView } =
    useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const type = selection === null ? undefined : findTypeByKey(schema, selection.kind, selection.key)
  if (selection === null || type === undefined) return null

  const isEntity = selection.kind === 'entity-types'
  const typeId = 'entityTypeId' in type ? type.entityTypeId : type.relationTypeId
  const Icon = isEntity ? Box : Workflow
  const selectType = (t: TypeRef) => select({ kind: t.kind, key: t.key })

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card 2xl:w-[360px]" aria-label="Inspector">
      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium text-muted-foreground">
          {isEntity ? 'Entity type' : 'Relation type'}
        </span>
        <span className="flex-1" />
        <AskAboutButton focus={{ kind: isEntity ? 'entityType' : 'relationType', key: selection.key }} />
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => switchView('classic')}
          title="Same components as a full page · switch with V"
        >
          <PanelTop /> Classic view
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close inspector" onClick={() => select(null)}>
          <X />
        </Button>
      </div>
      {/* relative: hidden form controls stay inside the scroll area, so the page never scrolls. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <TypeHeader
            key={typeId}
            ontologyKey={ontologyKey}
            kind={selection.kind}
            typeId={typeId}
            variant="panel"
            onSelectType={selectType}
          />
        </div>
        <Separator />
        <div className="p-4">
          <PropertiesEditor
            key={typeId}
            ontologyKey={ontologyKey}
            kind={selection.kind}
            typeId={typeId}
            density="compact"
            openRequest={openRequestOf(propertyRequest, schema.properties[typeId])}
            addRequest={addRequestOf(addPropertyRequest, selection)}
          />
        </div>
        {isEntity && (
          <>
            <Separator />
            <div className="p-4">
              <TypeRelations
                ontologyKey={ontologyKey}
                entityTypeId={typeId}
                variant="panel"
                onSelectType={selectType}
              />
            </div>
          </>
        )}
      </div>
      <div className="flex border-t p-3">
        <DeleteTypeButton kind={selection.kind} id={typeId} className="w-full" />
      </div>
    </aside>
  )
}
