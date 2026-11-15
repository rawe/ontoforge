/**
 * A browser and a client going through the authorization server, by
 * `inject` on one or several apps: a cookie jar that honours paths and
 * removals, the authorization from the first request to the client's
 * redirect (signing in at the stub provider and answering the consent
 * page on the way), and token requests.
 */

import { createHash, randomBytes } from "node:crypto";

import type { FastifyInstance, LightMyRequestResponse } from "fastify";

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The cookies of one browser. */
export class Jar {
  private readonly cookies = new Map<string, { name: string; value: string; path: string }>();

  take(header: string | string[] | undefined): void {
    for (const cookie of header === undefined ? [] : Array.isArray(header) ? header : [header]) {
      const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
      const separator = pair!.indexOf("=");
      const name = pair!.slice(0, separator);
      const value = pair!.slice(separator + 1);
      let path = "/";
      let removed = value === "";
      for (const attribute of attributes) {
        const [key, val = ""] = attribute.split("=");
        if (key!.toLowerCase() === "path") path = val;
        if (key!.toLowerCase() === "max-age" && Number(val) <= 0) removed = true;
        if (key!.toLowerCase() === "expires" && Date.parse(val) <= Date.now()) removed = true;
      }
      if (removed) this.cookies.delete(`${name} ${path}`);
      else this.cookies.set(`${name} ${path}`, { name, value, path });
    }
  }

  header(path: string): string {
    return [...this.cookies.values()]
      .filter((c) => path === c.path || path.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
}

export interface Visit {
  method?: "GET" | "POST";
  url: string;
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

/** One request through `app` as the browser of `jar`. */
export async function visit(app: FastifyInstance, jar: Jar, { method = "GET", url, form, headers = {} }: Visit): Promise<LightMyRequestResponse> {
  const target = new URL(url, "http://localhost");
  const res = await app.inject({
    method,
    url: target.pathname + target.search,
    headers: {
      ...headers,
      cookie: jar.header(target.pathname),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form ? { payload: new URLSearchParams(form).toString() } : {}),
  });
  jar.take(res.headers["set-cookie"]);
  return res;
}

export interface Request {
  clientId: string;
  redirectUri: string;
  resource?: string | string[];
  scope?: string;
  challenge: string;
}

export interface Outcome {
  /** Where the browser was sent last: the client's redirect URI with its answer, or a page. */
  location: URL | null;
  /** The last response, when it was a page rather than a redirect to the client. */
  page: LightMyRequestResponse | null;
  /** The consent page, when one was shown. */
  consent: string | null;
}

/**
 * Runs an authorization from `/oauth/authorize` to the client's redirect,
 * the requests going to `apps` in turn. The stub provider is whatever
 * origin `providerOrigin` names: its login page is skipped, the callback
 * called with its state. The consent page is answered with `decision`.
 */
export async function authorize(
  apps: FastifyInstance[],
  jar: Jar,
  request: Request,
  { publicUrl, providerOrigin, decision = "allow" }: { publicUrl: string; providerOrigin: string; decision?: "allow" | "deny" },
): Promise<Outcome> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    state: "client-state",
  });
  if (request.scope !== undefined) query.set("scope", request.scope);
  for (const resource of [request.resource ?? []].flat()) query.append("resource", resource);
  const origin = new URL(publicUrl).origin;
  let next: Visit = { url: `/oauth/authorize?${query}` };
  let consent: string | null = null;
  for (let step = 0; step < 12; step++) {
    const res = await visit(apps[step % apps.length]!, jar, next);
    if (res.statusCode === 200 && res.body.includes('name="decision"')) {
      consent = res.body;
      const action = /action="([^"]+)"/.exec(res.body)![1]!;
      next = { method: "POST", url: action, form: { decision }, headers: { origin } };
      continue;
    }
    const location = res.headers.location as string | undefined;
    if (location === undefined) return { location: null, page: res, consent };
    const target = new URL(location, publicUrl);
    if (target.origin === providerOrigin) {
      next = { url: `/oauth/callback?code=provider-code&state=${target.searchParams.get("state")}` };
    } else if (target.origin === origin) {
      next = { url: target.pathname + target.search };
    } else {
      return { location: target, page: null, consent };
    }
  }
  throw new Error("The authorization did not end");
}

/** A token request at `app`. */
export async function token(app: FastifyInstance, form: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    payload: new URLSearchParams(form).toString(),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, headers: res.headers };
}
