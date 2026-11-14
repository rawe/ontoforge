import { useEffect, useState } from 'react'

/** The clock, ticking twice a second while `running`; its value does not matter otherwise. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 500)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [running])
  return now
}
