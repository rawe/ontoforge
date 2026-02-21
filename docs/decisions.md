# OntoForge — Decision Log

> Append-only log of settled architectural and project decisions.
> Each entry records what was decided, why, and when.

## How to use this file

- **Append only.** Never edit or remove existing entries. If a decision is reversed, add a new entry that supersedes the old one.
- **Every architectural decision must be approved by the user.** AI sessions must use the AskUserQuestion tool before settling any decision — never decide silently.
- **One entry per decision.** Keep entries concise: what, why, date.
- **Newest entries at the bottom.**

## Guiding Principles

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.

---

## Decisions

### 001 — Single backend, modular monolith
**Date:** 2026-02-21
**Decision:** One Python backend application with separate route modules for modeling and runtime. Not two separate services.
**Reason:** Simplicity. Avoids premature distribution overhead. Modules can be separated later if needed.

### 002 — "Studio" rejected as product/component name
**Date:** 2026-02-21
**Decision:** Do not use "studio" for naming frontend apps or the product. Alternative TBD in Phase 0.
**Reason:** User preference.

### 003 — "Use" under review as runtime route name
**Date:** 2026-02-21
**Decision:** The current `/api/use` path name is under review. Alternative TBD in Phase 0.
**Reason:** "Use" / "usage" sounds unclear. Candidates: runtime, data, knowledge.
