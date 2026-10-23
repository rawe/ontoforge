/**
 * The shared-state Valkey connection against the dev Valkey: the boot
 * checks every aspect relies on — reachable, evicting nothing, able to run
 * scripts, no two scripts of one name — and a boot error never shows the
 * password.
 */

import { createHash } from "node:crypto";

import type { Valkey } from "iovalkey";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeValkey, connectValkey } from "../../../src/adapters/valkey/connection.js";
import { THREAD_SCRIPTS } from "../../../src/adapters/valkey/threadStore.js";
import { openAdmin, url } from "./support.js";

let admin: Valkey;

beforeAll(async () => {
  admin = await openAdmin();
});

afterAll(async () => {
  await admin.quit();
});

const sha1 = (lua: string) => createHash("sha1").update(lua).digest("hex");

describe("valkey connection", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads every aspect's scripts when it connects, not on first use", async () => {
    await admin.script("FLUSH");
    await closeValkey(await connectValkey(url, [THREAD_SCRIPTS]));
    const shas = Object.values(THREAD_SCRIPTS).map(({ lua }) => sha1(lua));
    expect(await admin.script("EXISTS", ...shas)).toEqual(shas.map(() => 1));
  });

  it("refuses two scripts of one name before connecting", async () => {
    const clash = { threadCreate: { lua: "return 1", numberOfKeys: 0 } };
    await expect(connectValkey(url, [THREAD_SCRIPTS, clash])).rejects.toThrow(/Two shared-state scripts are named 'threadCreate'/);
  });

  it("refuses a Valkey that evicts, cannot run the scripts or cannot be reached, without leaking the password", async () => {
    await admin.config("SET", "maxmemory-policy", "allkeys-lru");
    try {
      await expect(connectValkey(url, [THREAD_SCRIPTS])).rejects.toThrow(/maxmemory-policy must be noeviction, is allkeys-lru/);
    } finally {
      await admin.config("SET", "maxmemory-policy", "noeviction");
    }
    // A Valkey that may not run scripts (as some managed services restrict them).
    await admin.acl("SETUSER", "noscripts", "on", ">secret", "~*", "+@all", "-@scripting");
    try {
      const target = new URL(url);
      target.username = "noscripts";
      target.password = "secret";
      const restricted = connectValkey(target.toString(), [THREAD_SCRIPTS]);
      await expect(restricted).rejects.toThrow(/is not usable: .*NOPERM/);
      await expect(restricted).rejects.not.toThrow(/secret/);
    } finally {
      await admin.acl("DELUSER", "noscripts");
    }
    const unreachable = connectValkey("redis://user:secret@127.0.0.1:1", [THREAD_SCRIPTS]);
    await expect(unreachable).rejects.toThrow(/Shared state Valkey at redis:\/\/user:\*\*\*@127\.0\.0\.1:1/);
    await expect(unreachable).rejects.not.toThrow(/secret/);
  });
});
