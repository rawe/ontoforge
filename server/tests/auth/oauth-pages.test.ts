/**
 * The authorization server's pages: everything shown is escaped, a client
 * metadata document's host stands out, the page loads nothing and is never
 * framed.
 */

import { describe, expect, it } from "vitest";

import { consentPage, errorPage, PAGE_HEADERS } from "../../src/auth/oauthPages.js";

const consent = {
  person: "Ada <script>",
  personDetail: "ada@example.com",
  clientName: 'Agent "X" & co',
  clientId: "https://agent.example.com/client.json",
  redirectUri: "https://agent.example.com/cb?a=1&b=<2>",
  resource: { kind: "mcp" as const, ontologyKey: "books", lensKey: "public", rulesetKey: "<r>" },
};

describe("the consent page", () => {
  it("escapes every value and posts its answer to its own address", () => {
    const html = consentPage(consent, "/oauth/interaction/abc");
    expect(html).not.toContain("<script");
    expect(html).toContain("Ada &lt;script&gt; (ada@example.com)");
    expect(html).toContain("Agent &quot;X&quot; &amp; co");
    expect(html).toContain("https://agent.example.com/cb?a=1&amp;b=&lt;2&gt;");
    expect(html).toContain("ruleset <strong>&lt;r&gt;</strong>");
    expect(html).toContain('<form method="post" action="/oauth/interaction/abc">');
    expect(html).toContain('value="allow"');
    expect(html).toContain('value="deny"');
  });

  it("shows a metadata document's host first, a plain client ID as it is", () => {
    expect(consentPage(consent, "/x")).toContain("<strong>agent.example.com</strong><br><code>https://agent.example.com/client.json</code>");
    expect(consentPage({ ...consent, clientId: "ontoforge-cli" }, "/x")).toContain("<code>ontoforge-cli</code>");
  });

  it("names what is granted: the REST API, a modeling mount, a lens", () => {
    expect(consentPage({ ...consent, resource: { kind: "api" } }, "/x")).toContain("the REST API, with everything your roles allow");
    expect(consentPage({ ...consent, resource: { kind: "mcp", ontologyKey: "books", lensKey: null, rulesetKey: null } }, "/x")).toContain(
      "the modeling MCP mount of ontology <strong>books</strong>",
    );
  });
});

describe("the pages' headers", () => {
  it("forbid framing, caching and loading anything", () => {
    expect(PAGE_HEADERS["x-frame-options"]).toBe("DENY");
    expect(PAGE_HEADERS["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(PAGE_HEADERS["content-security-policy"]).toContain("default-src 'none'");
    expect(PAGE_HEADERS["cache-control"]).toBe("no-store");
  });

  it("escape an error description", () => {
    expect(errorPage("bad <b>")).toContain("bad &lt;b&gt;");
  });
});
