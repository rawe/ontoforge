# How we approach this

The goal is in [goal.md](goal.md). The facts about the current state are in
[inventory.md](inventory.md). This document says in which order we decide, and how we find
out what is actually needed.

Nothing about the target design is decided here.

---

## 1. How the pieces really fit together

I described this earlier as three layers. It is four, and the fourth one changes what the
problem is.

```
Service layer            where the capabilities actually live
    |
    +-- REST API         one view of them      used by the web client and integrators
    +-- Agent tools      one view of them      used by our own agents
    +-- MCP server       one view of them      used by an external coding agent
```

The agent tools and the MCP server are **not** built on the REST API. Both call the service
layer directly. That is a written rule in the project already: *"MCP runs inside the server
process and calls services directly. Not a wrapper over the REST API."* The agent tool
definitions do the same.

So the three interfaces are siblings, not a stack. Each of them writes down its own
parameter list by hand. There is no rule saying what an interface may leave out, and no
test that notices when one of them falls behind. That is why they no longer match.

This matters because it splits every problem into two small questions instead of one large
one:

1. Does the service layer have this capability at all?
2. Does each interface offer it — either faithfully, or deliberately not?

And it answers the question of what we change now and what we leave alone:

| Type of work | Example | Breaks anything? | Needs a decision? |
|---|---|---|---|
| **Missing parameter** — the service has it, one interface does not offer it | agent tools cannot page | No. Adding a parameter is safe | No, only the rule |
| **Surface change** — the service lacks something, or a name or a return value is wrong | keyword search, the two meanings of `q`, the two meanings of `total` | Yes | Yes, several |

Missing parameters can be fixed straight away and break nothing. Surface changes wait for
decisions. That is the whole plan for keeping damage low, and it follows from the picture
above rather than from a rule we have to remember.

---

## 2. Our agents and the external MCP server are different problems

They look alike, because both are a model calling tools. They pull in opposite directions.

| | **Our own agents** | **External MCP** |
|---|---|---|
| Who runs the model | We do. Often a small one | Someone else. Usually a strong one |
| What we control | The model, the prompt, the tool list, the loop | Nothing except what the mount offers |
| What goes wrong | The model picks the wrong tool, or cannot reach the data | The tool list uses up context. Composing calls is not the problem |
| So we want | Tools that are easy to pick by name: more tools, each doing one thing, few parameters | Fewer tools, each doing more, with rich parameters, to keep the tool list small |
| Tool selection today | Exists. Each agent config lists its allowed tools | Does not exist. All 20 tools, always |
| Who selects | We do, at design time | The client does, at connect time |

The project has already acted on the left column once. `search_documents` exists as a
separate agent tool because, in its own words, *"an agent may run the weakest model of any
caller and a name is chosen more reliably than a mode."* That reasoning is right for our
agents and does not carry over to the external server.

**What follows:** the two tool sets are decided separately, against different criteria.
Overlap is fine. Making them identical is not a goal.

---

## 3. How we find out what is needed

The inventory says what exists. It does not say what is needed. Guessing is how we ended up
with a hand-picked list of twelve agent tools with one exclusion nobody can explain.

Three measurements, one per caller. All three can be done with what is already built.

### For our agents: read the tool-call traces

The system already records every tool call an agent makes, and the chat operation can
return that trace on request.

Write down 10 to 15 tasks we genuinely want agents to do, phrased the way a user would
phrase them. Run each one against the default agent, which has every tool. Then read the
traces.

They tell us four things:

- which tools were actually used — a tool nobody used belongs in no set;
- where the agent looped or retried — it picked the wrong tool, or could not get a
  parameter right;
- which tasks never finished — a real gap, either in the service layer or in the tool;
- which tools always appear together — that is a set, found rather than invented.

Run it twice: once with a strong model, once with the weakest model we intend to support.
The difference between the two runs is where the set boundary lies. We do not have to
invent it.

### For the external MCP server: watch a coding agent use it

Point a coding agent at the runtime mount, give it the same kind of tasks, and read the
transcript.

This also answers the question we should ask before designing anything: **does the external
server need tool selection at all?** If a coding agent copes with 20 flat tools, the answer
is no, and the whole question of how to control the tool list disappears. If it struggles,
we will see how — and that decides whether the fix is fewer tools or better descriptions.

### For the API: look at what the web client calls

The web client is built and working, so every parameter it uses is proven to be needed. A
parameter nothing calls is not automatically wrong, but it stops being an argument for
keeping the current shape.

### What comes out

One list: task, and the capabilities it actually used. That list becomes the test later:

> A tool set is good enough when every task we assigned to its level can be finished
> using only tools from that set.

Sets are checked by finishing tasks, not by looking sensible on paper.

---

## 4. The order of decisions

Five steps. Each step can only be answered once the one before it is settled. Steps 4 and 5
are independent of each other and can run at the same time.

### Step 1 — Agree on the ground rules

No code. Blocks everything else.

**One place defines the capabilities.**
Is the service layer the authority on what the system can do, with REST, MCP and agent
tools being views of it? Without this there is no such thing as a wrong interface, and
every later question gets argued three times.

**The REST API offers everything.**
Is the API the complete view, built for completeness and for having each capability exactly
once, and never adjusted to make a language model's life easier? Your statement that the
API is not called by agents implies yes. Saying it out loud is what frees the API from
every small-model concern and moves all of that into the two tool layers.

This is the decision that matters most. An API that also has to be easy for a model to use
cannot be free of overlap, because being easy for a model means offering the same thing
twice under different names.

**Differences between interfaces need a stated reason.**
May one interface offer something another does not? Today the agent tools have
`search_documents`, which MCP does not, and MCP has `get_relation`, which agents may not
be given. Each was decided once, on its own. Either that is a rule we can apply to the next
case, or those two are accidents.

### Step 2 — Measure instead of guess

**Run the three measurements** from section 3 before deciding anything about content.

**Only measured needs count.**
This sounds like paperwork and is not. Without it, the theoretical gaps listed in the
inventory come straight back in as requirements, and we are guessing again.

### Step 3 — Decide about the API

**How read operations are grouped.**
This is the decision that determines whether a future need is "add a parameter" or "rework
the surface". It is a naming and grouping decision, so it is cheap, and it is worth real
time.

**Which measured gaps are missing capabilities and which are missing parameters.**
The first kind means new work in the service layer. The second kind is a parameter that
already exists elsewhere and just needs to be offered.

**What may break, and when.**
A reasonable starting position: nothing breaks in this round. Renames and changed return
values are collected and land together in one deliberate step later, so the web client and
any integrator pay the cost once.

### Step 4 — Decide about our agents

**Named sets, hand-picked lists, or both.**
The hand-picked list exists and works. The question is whether named sets replace it or sit
next to it.

**Which tools belong in which set** — read off the traces, not off a classification.

**May an agent tool differ from the same operation's MCP tool?**
Right now the answer is yes everywhere, without anyone having said so: different limits,
different defaults, missing parameters. Deciding it explicitly turns those differences into
either choices or bugs. At the moment they are neither.

### Step 5 — Decide about the external MCP server

**Does it need tool selection at all?** Answerable only after watching a coding agent use
the mount.

**Named sets, or a list of tool names the client sends.**
A client-sent list means the client config carries a dozen strings and the server has to
validate names it does not own. Named sets mean one string, but the server has to maintain
and version that vocabulary.

**Where the selection is carried.** This one conflicts with an existing rule, so it has to
be taken as a rule change, not as an implementation detail.

The project currently states: *"The URL is the only binding channel — no header or env
fallback."* The reason given is that one address should describe one scope completely and
be reproducible from a client configuration file. A tool set is arguably not a binding in
that sense, but a header would still be a second channel deciding what a mount offers, and
the tool listing would then differ for the same URL, which some clients cache.

The options, and what each costs. Not to be decided before we know it is needed:

| Option | Shape | What it costs |
|---|---|---|
| Let the client filter | Nothing on the server. The coding agent's own setup filters | No work at all, but no control over an arbitrary client |
| A segment in the URL | `.../lenses/{lens}/profiles/{name}` | Follows the existing rule. The address says what it offers. One mount per set |
| A query parameter on the mount URL | `.../lenses/{lens}?tools=navigating` | Still part of the address, with less ceremony than a path segment |
| An HTTP header | `X-OntoForge-Tools: navigating` | In practice it sits in the same client config file as the URL, so it is just as easy to use. But it contradicts the stated rule, it is invisible in the address, and the tool listing then depends on URL and header together |

---

## 5. What I would do first

Everything in Step 1 and Step 2 costs no product code and unblocks the rest.

1. Settle the three ground rules. Three yes-or-no answers.
2. **Write the task list** — 10 to 15 tasks per caller, phrased the way a user would ask.
   This is the most valuable piece of the whole effort and it needs you, not me.
3. Run the measurements and produce the list of task and capability.
4. Only then open Step 3.

Separately and straight away, because these are missing parameters and break nothing: the
four findings in the inventory that make a question unanswerable at one interface while the
same question can be answered at another. Those are not design questions. They are an
interface that forgot a parameter, and they can be fixed under the first ground rule alone.

They are:

- *Agent entity search silently includes documents*
- *Agent tools cannot reach the second page*
- *Agent entity search requires a type while its sibling does not*
- *MCP accepts free text where REST accepts a fixed list*

---

## 6. What we are deliberately not deciding yet

- The search redesign — what gets ranked, how it gets ranked, whether keyword search
  exists. That belongs in Step 3 and needs the measurements first.
- The contents of any tool set. Steps 4 and 5.
- Keyword search itself. It is the largest single piece of work in this whole area and
  should not be scheduled before a measurement shows that a caller needs it.
