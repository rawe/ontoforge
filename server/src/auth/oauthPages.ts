/**
 * The pages the authorization server shows a person: the consent page and
 * plain messages. Server-rendered HTML without scripts or outside
 * resources, every value escaped. `PAGE_HEADERS` keeps them out of frames
 * and caches; cross-site submission of the consent form is refused by its
 * route (`oauthRouter.ts`).
 */

import type { Resource } from "./resources.js";

/** Never framed, never cached, nothing loaded from elsewhere. The referrer policy keeps the
 * `Origin` header on the consent form's own answer (a browser sends `null` under
 * `no-referrer`) and tells other sites nothing. */
export const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "referrer-policy": "same-origin",
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** The pages' whole styling: one card, readable in a light and a dark browser. */
const STYLE = `:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#1f2328;--muted:#59636e;--line:#d1d9e0;--warn:#9a6700;--warn-bg:#fff8c5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--ink:#e6edf3;--muted:#9198a1;--line:#30363d;--warn:#d29922;--warn-bg:#2b2206}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:32rem;margin:8vh auto;padding:1.75rem 2rem;background:var(--card);border:1px solid var(--line);border-radius:12px}
.brand{margin:0 0 1rem;font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 .75rem;font-size:1.4rem;line-height:1.25}
p{margin:.5rem 0}dl{margin:1.25rem 0 0}
dt{margin-top:.85rem;font-size:.8rem;font-weight:600;color:var(--muted)}dd{margin:.1rem 0 0;overflow-wrap:anywhere}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace}
.notice{margin:1.25rem 0 0;padding:.7rem .9rem;border-left:4px solid var(--warn);border-radius:4px;background:var(--warn-bg)}
form{display:flex;gap:.75rem;margin-top:1.5rem}
button{font:inherit;font-weight:600;padding:.55rem 1.4rem;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);cursor:pointer}
button[value=allow]{border-color:#4f46e5;background:#4f46e5;color:#fff}`;

/** A whole page; `body` is HTML whose values are already escaped. */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} — OntoForge</title><style>${STYLE}</style></head><body><main><p class="brand">OntoForge</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

/** A plain message: a title and one sentence. */
export function messagePage(title: string, text: string): string {
  return page(title, `<p>${escapeHtml(text)}</p>`);
}

/** The page of an authorization request the server refused. */
export function errorPage(description: string): string {
  return page("This request cannot be completed", `<p>${escapeHtml(description)}</p><p>Return to the application and try again.</p>`);
}

export interface Consent {
  /** The signed-in person: display name, and email or username when known. */
  person: string;
  personDetail: string | null;
  clientName: string;
  clientId: string;
  redirectUri: string;
  resource: Resource;
  /** The person holds no role the mount needs: the token will be refused there. */
  noAccess: boolean;
}

/** One sentence whether the mount is unknown or the role is missing: it gives nothing away. */
const NO_ACCESS = `<p class="notice"><strong>Your account has no access to this MCP mount.</strong> The application will be refused there until an administrator gives you a role on it.</p>`;

function granted(resource: Resource): string {
  if (resource.kind === "api") return "the REST API, with everything your roles allow";
  const ontology = `ontology <strong>${escapeHtml(resource.ontologyKey)}</strong>`;
  if (resource.lensKey === null) return `the modeling MCP mount of ${ontology}`;
  const ruleset = resource.rulesetKey === null ? "" : `, ruleset <strong>${escapeHtml(resource.rulesetKey)}</strong>`;
  return `the MCP mount of ${ontology}, lens <strong>${escapeHtml(resource.lensKey)}</strong>${ruleset}, with what your role there allows`;
}

/** A client ID that is a URL (a client metadata document) shows its host first. */
function clientIdHtml(clientId: string): string {
  const url = URL.parse(clientId);
  if (url === null || url.protocol !== "https:") return `<code>${escapeHtml(clientId)}</code>`;
  return `<strong>${escapeHtml(url.host)}</strong><br><code>${escapeHtml(clientId)}</code>`;
}

/** The consent page: who asks, for whom, where the answer goes, what is granted; Allow or Deny. */
export function consentPage(consent: Consent, action: string): string {
  const person = escapeHtml(consent.person) + (consent.personDetail === null ? "" : ` (${escapeHtml(consent.personDetail)})`);
  return page(
    "Allow access?",
    `<p><strong>${escapeHtml(consent.clientName)}</strong> wants to act as you in OntoForge.</p>
<dl>
<dt>Signed in as</dt><dd>${person}</dd>
<dt>Application</dt><dd>${escapeHtml(consent.clientName)}</dd>
<dt>Client ID</dt><dd>${clientIdHtml(consent.clientId)}</dd>
<dt>The answer goes to</dt><dd><code>${escapeHtml(consent.redirectUri)}</code></dd>
<dt>Access to</dt><dd>${granted(consent.resource)}</dd>
</dl>${consent.noAccess ? `\n${NO_ACCESS}` : ""}
<form method="post" action="${escapeHtml(action)}">
<button type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}
