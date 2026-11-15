/**
 * What a token of this server's authorization server opens: exactly one
 * resource (RFC 8707), named by the client when it asks for the token. A
 * resource is the URL of one MCP mount (`PUBLIC_URL` and the mount's path),
 * or `PUBLIC_URL/api` for the whole REST API; nothing else is one.
 *
 * Roles decide what the person may do there, so clients deal with no
 * scopes. The one scope only exists because the library grants nothing
 * without one: the authorization server sets it on every authorization
 * itself, whatever the client asked for.
 */

/** The scope of every authorization: to act as the signed-in person. */
export const SCOPE = "ontoforge";

export type Resource =
  | { kind: "api" }
  | { kind: "mcp"; ontologyKey: string; lensKey: string | null; rulesetKey: string | null };

/** The paths of the MCP mounts (`mcp/mount.ts`): the modeling mount, a lens's and a ruleset's. */
const MOUNT = /^\/mcp\/ontologies\/([^/?#]+)\/(?:model|runtime\/lenses\/([^/?#]+)(?:\/rulesets\/([^/?#]+))?)$/;

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The resource `indicator` names below `publicUrl`, or null when it names none. */
export function resourceOf(indicator: string, publicUrl: string): Resource | null {
  if (indicator === `${publicUrl}/api`) return { kind: "api" };
  if (!indicator.startsWith(`${publicUrl}/`)) return null;
  const mount = MOUNT.exec(indicator.slice(publicUrl.length));
  if (mount === null) return null;
  const [, ontologyKey, lensKey, rulesetKey] = mount;
  return {
    kind: "mcp",
    ontologyKey: decoded(ontologyKey!),
    lensKey: lensKey === undefined ? null : decoded(lensKey),
    rulesetKey: rulesetKey === undefined ? null : decoded(rulesetKey),
  };
}

/** The resource a request to `path` (no query) uses a token for: its MCP mount's URL, or the
 * REST API's; null outside both. */
export function resourceOfRequest(path: string, isMcpMount: boolean, publicUrl: string): string | null {
  if (isMcpMount) return publicUrl + path;
  if (path.startsWith("/api/")) return `${publicUrl}/api`;
  return null;
}
