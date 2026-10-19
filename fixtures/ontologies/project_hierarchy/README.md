# project_hierarchy

Parent relations, anchors and documents: a Customer › Project › Task hierarchy with a
required relation property, an up-pointing and a self-relation parent relation, a separate
`manages` hierarchy, free types, lenses that hide a hierarchy level, and a document
property on task.

## Entity types

Every type has the string `name`. `task` also has `description` (document, optional).

## Relation types

| Key | From → to | Parent | Notes |
|---|---|---|---|
| `has_project` | customer → project | source | down-pointing |
| `has_task` | project → task | source | required property `phase` (string) |
| `has_subtask` | task → task | source | self-relation; a second parent relation into task |
| `belongs_to` | milestone → project | target | up-pointing |
| `manages` | person → person | source | a separate hierarchy |
| `assigned_to` | task → person | — | ordinary; T3 has two persons |
| `has_status` | task → status | — | ordinary |
| `mentors` | person → person | — | ordinary, between free entities |

## Entities

ACME (P1: T1 › T1a › T1a1, T2 › T2a, T3, M1; P2: T4, T5), BETA (P3: T6, M2).
Persons Lea (manages Ben, Kim, Ana); statuses open, doing, done.
T3 is assigned to two persons. 23 entities, 33 relations.

Tasks with a Markdown `description`: T1 (2,992 characters, long enough to slice), T1a
(682), T3 (716), T4 (465), T6 (600); the other tasks leave it unset.

## Lenses

- `all`: unscoped
- `portfolio`: customer, project, milestone (task hidden)
- `no_projects`: customer, task, milestone (project hidden; milestone's only parent relation hidden); includes the passage index `task~description`

Anchors are runtime state and not part of the fixture.
