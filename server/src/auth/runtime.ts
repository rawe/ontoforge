/**
 * What authentication runs on when it is enabled: its settings, the
 * provider, the access store and the browser sessions. The app carries it
 * as `app.auth` (null when authentication is off), so every entrance reads
 * the same instance.
 */

import type { AccessStore } from "../access/store.js";
import type { AuthSettings } from "../config.js";
import type { Oidc } from "./oidc.js";
import type { SessionStore } from "./sessionStore.js";

export interface AuthRuntime {
  settings: AuthSettings;
  oidc: Oidc;
  access: AccessStore;
  sessions: SessionStore;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Null when authentication is off. */
    auth: AuthRuntime | null;
  }
}
