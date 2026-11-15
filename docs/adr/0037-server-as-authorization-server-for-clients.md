# The server as the authorization server for clients acting for a person

Current behavior: [The authorization server](../capabilities/authentication.md#the-authorization-server)

## Context

An MCP client, or an application calling REST for a signed-in person, needs an OAuth
authorization server that knows it and issues it a token. Identity providers differ in
what they offer such clients: Entra ID has neither dynamic client registration nor client
ID metadata documents, and accepts only a registered resource, while every MCP mount has
an address of its own. Cloud clients also reach the authorization server from their own
network.

## Decision

The OntoForge server is the OAuth authorization server for clients acting for a person,
on MCP and on REST. It identifies a client by its client ID metadata document, or by an
entry in its own configuration for a tool that cannot publish one, delegates the person's
sign-in to the configured identity provider through the one client it also signs browsers
in with, and issues opaque tokens of its own, each for one resource. Machines present the
provider's tokens.

## Consequences

The server issues tokens and so stands in the security-critical path; it asks the person's
consent for every authorization. The identity provider needs one registered client and
must be reachable only by the person's browser and the server, not by the clients. The
server needs outbound https to read client documents.

## Rejected

- **The identity provider as the authorization server.** The least code, and OntoForge
  issues no tokens. But clients connect unaided only where the provider can register them,
  which Entra ID cannot; the provider must be public for cloud clients, takes anonymous
  client registrations, and needs its own audience configuration per provider.
- **A Keycloak in front of every provider.** No authorization-server code in OntoForge,
  but a further component to run, expose and upgrade in every deployment, whose client
  registration for MCP is experimental.
- **Dynamic client registration.** Every connection leaves a client record written by an
  anonymous caller; the MCP specification deprecates it in favour of client ID metadata
  documents.
- **Signed JWTs as the server's tokens.** They save one read per call, but refresh tokens
  are stored either way, and an authorization revoked for a reused refresh token would stay
  usable until its access tokens expire.
