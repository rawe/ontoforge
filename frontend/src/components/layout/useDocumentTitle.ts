import { useEffect } from 'react'

/** Names the browser tab after the current surface; back to "OntoForge" when unmounted. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title === undefined) return
    document.title = title
    return () => {
      document.title = 'OntoForge'
    }
  }, [title])
}
