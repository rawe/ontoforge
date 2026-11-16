/** A monotonic animation timeline that excludes time spent paused. */
export class PlaybackClock {
  private pausedAt: number | null = null
  private pausedDuration = 0

  get paused(): boolean { return this.pausedAt !== null }

  time(now: number): number { return (this.pausedAt ?? now) - this.pausedDuration }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now
  }

  resume(now: number): void {
    if (this.pausedAt === null) return
    this.pausedDuration += now - this.pausedAt
    this.pausedAt = null
  }
}
