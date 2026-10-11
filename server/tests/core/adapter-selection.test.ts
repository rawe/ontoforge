/**
 * Adapter selection: `DB_BACKEND` names the storage adapter, and a value
 * no adapter answers to fails the boot before any connection is opened,
 * naming the supported values.
 */

import { afterEach, describe, expect, it } from "vitest";

import { settings } from "../../src/config.js";
import { initStores } from "../../src/core/ports.js";

const configured = settings.DB_BACKEND;

afterEach(() => {
  settings.DB_BACKEND = configured;
});

describe("DB_BACKEND", () => {
  it("an unknown value fails the boot and names the supported adapter", async () => {
    settings.DB_BACKEND = "other";
    await expect(initStores()).rejects.toThrow("Unknown DB_BACKEND 'other' (supported: postgres)");
  });
});
