# The server as the browser's OpenID client

Rule: [Access](../decisions.md#access)

## Context

With authentication on, a person signs in at the identity provider in the browser and then
uses the web client as themselves. The web client is static, served behind a proxy on the
deployment's own address, and its calls must carry the person's identity to the server
without exposing a credential a script could take.

## Rejected

- **The web client as a public OpenID client holding tokens.** Access and refresh tokens
  would live where any script on the page can read them.
- **A separate UI server holding the session.** A further runtime component to deploy,
  scale and secure, which would carry the person to the server by a forwarded credential
  the server must then trust.
