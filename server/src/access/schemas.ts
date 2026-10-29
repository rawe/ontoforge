/**
 * The wire shapes of users and their assignments, shared by user
 * management (`router.ts`) and `/api/auth/me` (`auth/router.ts`).
 */

import { z } from "zod";

import { ROLES } from "./store.js";

export const Role = z.enum(ROLES);

export const User = z.object({
  id: z.string(),
  kind: z.enum(["user", "service"]),
  displayName: z.string(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});

export const Assignment = z.object({
  id: z.string(),
  role: Role,
  ontologyKey: z.string().nullable(),
  lensKey: z.string().nullable(),
  ontologyId: z.string().nullable(),
  lensId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
