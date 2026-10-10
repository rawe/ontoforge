/**
 * Guards for single-key shortcuts. A shortcut must not fire while the user
 * types, nor while a dialog, popover, menu or open list box handles its own
 * keys. An overlay that is animating out (Radix keeps it mounted with
 * `data-state="closed"` for a moment, focus still inside) counts as neither.
 */

/**
 * Focus is in a visible input, textarea, select or contenteditable. Given the
 * key event, also when the key's target left the page while the key was
 * handled: an inline edit that closes itself on Esc has removed its field
 * before the key reaches a window listener.
 */
export function isTyping(e?: KeyboardEvent): boolean {
  if (e?.target instanceof Node && !e.target.isConnected) return true
  const el = document.activeElement as HTMLElement | null
  if (el === null || el === document.body || !el.isConnected) return false
  if (el.getClientRects().length === 0) return false // hidden
  if (el.closest('[data-state="closed"]') !== null) return false // closing overlay
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

const OVERLAYS = '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"]'

/**
 * A dialog, popover, menu or open list box is showing. Overlays animating out
 * are ignored, except for Escape, which is what just closed them.
 */
export function overlayOpen(e?: KeyboardEvent): boolean {
  return [...document.querySelectorAll(OVERLAYS)].some(
    (el) => e?.key === 'Escape' || el.closest('[data-state="closed"]') === null,
  )
}

/** A key press without ⌘, Ctrl or Alt, which may drive a single-key shortcut. */
export function isPlainKey(e: KeyboardEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey
}
