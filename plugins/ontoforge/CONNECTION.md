# Connecting to an OntoForge server

Every skill in this plugin talks to one OntoForge server. Which server it talks to, and
whether that server needs a token, are two independent settings.

| Setting | Question | Variable |
|---|---|---|
| **Server** | Where is OntoForge? | `ONTOFORGE_BASE_URL` |
| **Token** | Is authentication enabled on it? | `ONTOFORGE_API_TOKEN` |

There is no mode switch. A **local** server is the one the `ontoforge-setup` skill runs
with Docker Compose on this machine, at `http://localhost:8000`. A **remote** server is
any other address you are given. Either one may have authentication enabled.

| | No authentication | Authentication enabled |
|---|---|---|
| Local | nothing to set | `ONTOFORGE_API_TOKEN` |
| Remote | `ONTOFORGE_BASE_URL` | `ONTOFORGE_BASE_URL` and `ONTOFORGE_API_TOKEN` |

## Server

The base URL is the address the OntoForge API is served at, without a path — REST and MCP
paths are appended to it. It resolves in this order, first match wins:

1. the script's `--base-url` flag, where the script has one
2. `ONTOFORGE_BASE_URL` in the file `ONTOFORGE_ENV_FILE` names
3. the `ONTOFORGE_BASE_URL` environment variable
4. `http://localhost:8000`, the local server

Every script prints the server it uses and where that came from as its first line, e.g.
`Server: https://ontoforge.example.com (from ONTOFORGE_BASE_URL)`. Check it before
anything that writes, imports or deletes. For a remote server, `GET /api/server/info`
answers its version and is the cheapest way to confirm the address.

## Token

Needed only when authentication is enabled on the server; every request then carries
`Authorization: Bearer <token>`. It resolves in this order:

1. `ONTOFORGE_API_TOKEN` in the file `ONTOFORGE_ENV_FILE` names, or the whole file when it
   holds nothing but the token
2. the `ONTOFORGE_API_TOKEN` environment variable

Without a token, requests carry no `Authorization` header. A `401` means the token is
missing or was rejected, and the scripts say which.

## Connection profiles

`ONTOFORGE_ENV_FILE` names a file of `KEY=value` lines that holds `ONTOFORGE_BASE_URL`,
`ONTOFORGE_API_TOKEN` or both — one file per server keeps a remote server's address and
token together:

```bash
ONTOFORGE_ENV_FILE=~/.config/ontoforge/staging.env node <skill>/scripts/...
```

Only those two keys are read from it; everything else in the file is ignored. What the
named file holds wins over the environment variables, because naming a file is the more
specific choice.

## MCP clients

An MCP client reads its configuration itself, so `ONTOFORGE_ENV_FILE` does not apply
there. The `ontoforge-setup` skill writes an `.mcp.json` that expands
`${ONTOFORGE_BASE_URL:-http://localhost:8000}` and `${ONTOFORGE_API_TOKEN:-}` from the
environment the client starts in; the same file serves all four cases above.

## Handling the token

The token is the user's secret. The assistant never handles its value:

- Never ask the user to paste it into the conversation, never read a file that holds it,
  and never print, echo or write its value — not into code, tests, fixtures, commits or
  docs.
- Check whether it is set by presence only: `[ -n "$ONTOFORGE_API_TOKEN" ]`.
- Hand over a profile by path: `ONTOFORGE_ENV_FILE=<path>`. The path is all the assistant
  handles; the file's content stays unread.
- Let the scripts make the API calls. Where a call has no script, use the variable, never
  its value: `curl -H "Authorization: Bearer $ONTOFORGE_API_TOKEN" ...`.
- On a token error, ask the user where the token lives — an environment variable set
  before the assistant started, or a profile path — and rerun with their answer.
- Code the assistant writes reads the token from the application's configuration at run
  time, never from a literal.
