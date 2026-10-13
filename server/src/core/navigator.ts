/**
 * Navigators (`runtime/assistants/navigators/`): what one stored
 * configuration is. The configuration is kept as stored — a version or
 * shape this release cannot run stays readable and exportable, and the
 * navigator's check reports it invalid.
 */

/** One stored navigator. */
export interface NavigatorRecord {
  navigatorId: string;
  key: string;
  name: string;
  description: string | null;
  configVersion: number;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** What a write stores. */
export type NavigatorWrite = Omit<NavigatorRecord, "createdAt" | "updatedAt">;
