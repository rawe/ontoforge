# The server as the browser's OpenID client

Current behavior: [Signing in](../capabilities/authentication.md#signing-in)

## Context

With authentication on, a person signs in at the identity provider in the browser and then
uses the web client as themselves. The web client is static, served behind a proxy on the
deployment's own address, and its calls must carry the person's identity to the server
without exposing a credential a script could take.

## Decision

The OntoForge server is the browser's confidential OpenID client. It handles the provider
exchange and holds the browser session in shared state; the browser receives an HttpOnly
session cookie rather than provider access and refresh tokens available to scripts.

## Consequences

The static web client does not become a token-holding public client, and no separate UI
session server or forwarded-credential trust boundary is deployed. The server owns the
login/session handling; loss of the recoverable session requires a new sign-in.

## Rejected

- **The web client as a public OpenID client holding tokens.** Access and refresh tokens
  would live where any script on the page can read them.
- **A separate UI server holding the session.** A further runtime component to deploy,
  scale and secure, which would carry the person to the server by a forwarded credential
  the server must then trust.
