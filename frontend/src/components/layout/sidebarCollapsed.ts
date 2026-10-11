/**
 * Whether the sidebar is collapsed to an icon rail. One preference for both
 * surfaces (Workbench and Studio), stored under `of.sidebar`; a small
 * external store, so the sidebars and the schema palette share it.
 */

import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'
import { isTyping, overlayOpen } from '@/lib/shortcuts'
import { readString, storageKeys, writeString } from '@/lib/storage'

let collapsed = readString(storageKeys.sidebar) === 'collapsed'
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function toggle() {
  collapsed = !collapsed
  writeString(storageKeys.sidebar, collapsed ? 'collapsed' : 'expanded')
  listeners.forEach((l) => l())
}

export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  return { collapsed: useSyncExternalStore(subscribe, () => collapsed), toggle }
}

/**
 * `[` toggles the sidebar — not while typing, nor while a dialog, popover,
 * menu or list box is open. Registered once per surface, by its sidebar.
 * Matched on the produced character, so layouts that type `[` with a
 * modifier (Option+5 on a German Mac, AltGr+8 on Windows) work; Cmd/Ctrl
 * combinations stay with the browser.
 */
export function useSidebarShortcut(): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== '[' || e.repeat || e.metaKey || (e.ctrlKey && !e.altKey)) return
    if (e.defaultPrevented || isTyping(e) || overlayOpen(e)) return
    e.preventDefault()
    toggle()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
