/**
 * Tiny event bus for the global Quick Add dialog: pages and the sidebar call
 * `openQuickAdd()`; the dialog (mounted once in WorkbenchLayout) listens.
 */

export const QUICK_ADD_EVENT = 'of:quick-add'

export interface QuickAddDetail {
  typeKey?: string
}

/**
 * Opens the global Quick Add dialog from anywhere in the workbench.
 * Pass a `typeKey` to skip the type-picker step.
 */
export function openQuickAdd(typeKey?: string): void {
  // Deferred so a dispatch from a page's mount effect still reaches the
  // dialog's listener (which registers in a later sibling's effect).
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent<QuickAddDetail>(QUICK_ADD_EVENT, { detail: { typeKey } }),
    )
  }, 0)
}
