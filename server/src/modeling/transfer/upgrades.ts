/**
 * The transfer format's upgrade chain: import reads the current version
 * only, and every older version it still accepts reaches the current one
 * through upgraders, one per version, each turning a payload of its
 * version into one of the next (`docs/capabilities/transfer.md#the-format-version`).
 *
 * The table below is the one place that knows the older versions: import
 * applies its upgraders from the payload's version on, and the versions
 * import accepts are the current one and the table's. Dropping a version
 * deletes its entry and its module, nothing else.
 */

import { ValidationError } from "../../core/exceptions.js";
import { TRANSFER_FORMAT_VERSION, TransferEnvelope } from "../schemas.js";
import { readFields, type Upgraded, type Upgrader } from "./upgrader.js";
import { upgrade5to6 } from "./upgrade5to6.js";
import { upgrade6to7 } from "./upgrade6to7.js";

/** Every older version import accepts, oldest first, with its upgrader. */
const UPGRADES: Record<string, Upgrader> = {
  "5.0": upgrade5to6,
  "6.0": upgrade6to7,
};

/** Every version import accepts, newest first; an absent version is the
 * current one. */
export const IMPORTABLE_FORMAT_VERSIONS: readonly string[] = [
  TRANSFER_FORMAT_VERSION,
  ...Object.keys(UPGRADES).reverse(),
];

/**
 * Bring a payload up to the current version. The request shape (an
 * object, an optional version string) is checked first, then the version;
 * any other version is refused with a field error naming the importable
 * ones.
 */
export function upgradeToCurrent(body: unknown): Upgraded {
  const payload = readFields(TransferEnvelope, body);
  const version = payload.formatVersion ?? TRANSFER_FORMAT_VERSION;
  if (!IMPORTABLE_FORMAT_VERSIONS.includes(version)) {
    throw new ValidationError(`Unsupported transfer format version '${version}'`, {
      fields: { formatVersion: `Expected one of ${IMPORTABLE_FORMAT_VERSIONS.join(", ")}` },
    });
  }
  const versions = Object.keys(UPGRADES);
  let upgraded: Upgraded = { payload, retrieverWarnings: new Map() };
  for (const from of versions.slice(version === TRANSFER_FORMAT_VERSION ? versions.length : versions.indexOf(version))) {
    const next = UPGRADES[from]!(upgraded.payload);
    upgraded = {
      payload: next.payload,
      retrieverWarnings: new Map([...upgraded.retrieverWarnings, ...next.retrieverWarnings]),
    };
  }
  return upgraded;
}
