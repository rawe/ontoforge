/**
 * Tiny event bus for the global Quick Add dialog: pages and the sidebar call
 * `openQuickAdd()`; the dialog (mounted once in WorkbenchLayout) listens.
 */

export const QUICK_ADD_EVENT = 'of:quick-add'

/** The fixed parent of a create with a parent relation ("+ Task under P1"). */
export interface QuickAddParent {
  /** The parent relation type's key; the new entity is its child end. */
  relationTypeKey: string
  typeKey: string
  id: string
  label: string
  /** Set when the parent exists only in this changeset (created there): the child is staged there too. */
  changesetId?: string
}

export interface QuickAddDetail {
  typeKey?: string
  parent?: QuickAddParent
}

/**
 * Opens the global Quick Add dialog from anywhere in the workbench.
 * Pass a `typeKey` to skip the type-picker step, and a `parent` to create
 * the entity under it in one call.
 */
export function openQuickAdd(typeKey?: string, parent?: QuickAddParent): void {
  // Deferred so a dispatch from a page's mount effect still reaches the
  // dialog's listener (which registers in a later sibling's effect).
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent<QuickAddDetail>(QUICK_ADD_EVENT, { detail: { typeKey, parent } }),
    )
  }, 0)
}
