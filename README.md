# Claude Spend Intelligence: Pacing, Not Caps

A prototype for the AI platform owner: the IT or engineering productivity lead who rolled out Claude Enterprise and answers to Finance for the bill. It goes with the two-page write-up, *Half my AI spend is wasted; I just don't know which half*. More detail is in [NOTES.md](NOTES.md).

The argument in short: spend caps don't control spend, they control who gets stopped. They cut off the busiest engineers first, while a stuck agent keeps spending under everyone's limit. The prototype focuses on Claude Code and its agents, where spend grows fastest.

It covers the write-up's V1:

- **Monthly team forecasts:** where each team's spend will land this month, shown as a range (likely to high case) until accuracy is proven.
- **Fix it or fund it:** splits any gap into waste to fix (retry loops, premium models on routine work, a broken prompt cache) and new work to fund (work producing results, like merged PRs and tests that stay passing).
- **Pacing, least intrusive step first:** the expected overrun is spread over the whole month instead of hitting hard caps at month end. Spend with the least evidence of results is slowed first; work producing results is protected.
- **Basic user-level nudges:** each person gets a private note about their own spend.
- **Claude drafts every change from the engine's numbers;** the admin approves. Nothing changes until then.

**Try it:** [demo-spend-intel.vercel.app](https://demo-spend-intel.vercel.app) (passcode in the write-up). A small marker next to "Admin" shows **Live** (agents run on Claude), **Replayed** (Live, but the last answer fell back to a recorded run) or **Offline** (recorded runs only). Every number is computed live either way.

## From the write-up to the prototype

| Write-up | In the prototype |
|---|---|
| The admin sets a budget; the system forecasts and paces spend to land on it | Spend forecast (likely and high case) and the month's slowing plan, spread evenly from day 1 |
| Nudges escalate with how far spend is off pace, starting with switching default models | Busy-day overruns move to a lighter default model first; only what that doesn't cover waits a few hours |
| Known waste patterns first | Three waste causes: a retry loop, subagents on Opus, a broken prompt cache |
| Once approved, policies cut off runaway agent retries | Proposed changes: auto-retry off after 3 failures for the Jira connector |
| Positive signals: new hires, merged PRs, tests that stay passing | The new engineers' evidence (31 merged PRs, 212 newly passing tests), Medium confidence until the 30-day check |
| Every change shows its numbers and needs admin approval | Drafts come only from the engine; nothing applies without approval |

The full table is in [NOTES.md](NOTES.md).

## Built with Claude Code

The app was designed and built in Claude Code: the engine, the interface, the tests, the browser checks and the answers eval. In development, the app's agents also run on the local Claude Code login through the Claude Agent SDK, with no API key.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev -- -p 3123     # http://localhost:3123
```

**Passcode (optional):** set `APP_PASSCODE` in `.env.local`, then restart. **`?first`** in the address shows the first visit again (tour and a fresh start).

**How the agents run:**

| Setup | What happens |
|---|---|
| Claude Code signed in on this machine (default in development) | Live, on your Claude Code login; counts against your plan's usage |
| `AGENT_BACKEND=api` and `ANTHROPIC_API_KEY` in `.env.local` | Live, on the Messages API, with run and daily spend limits (see `.env.example`) |
| Neither, or **··· menu → Offline replay** | Recorded runs replay; every number is still computed live. Nothing calls Claude |

A live run that fails or writes a number the engine didn't produce falls back to replay. Other commands:

```bash
npm test                 # engine, pacing, grounding and click-flow tests
npm run typecheck
npm run lint
npm run walk -- C pe     # print the guided flow: chips, answers and drafts at each step
npm run record           # re-record the agent runs (uses the Claude Code login)
npm run eval             # answers eval, offline and free (see "Answer quality evals" below)
npm run build && npm start
```

## Demo walkthrough (about 5 minutes)

The app is one Claude conversation that only moves forward. It opens with a headline, a button for the next step, and a live **Spend forecast** with **Recommendations** (Fix or Fund, the amount, High, Medium or Low confidence).

Default scenario, **Waste and new work**, Platform Engineering: heading for $56,900 on a $40,000 budget. It has $10,800 of waste (a Jira connector retrying a failing call, Claude Code subagents on Opus doing Sonnet-level tasks, a shared setup that broke prompt caching) and 14 new engineers who joined mid-month and are shipping. Per-person limits would cut off 9 of them by day 18 while the connector keeps spending.

1. **Fix all the waste** (the button under the headline). Claude drafts **Proposed changes**: you apply the connector and subagent fixes, and the cache fix goes to the dev tools team. Apply them: spend drops to $48,200.
2. **Draft the budget owner brief.** A request for the rest, backed by the new engineers' evidence. Mark it approved (demo).
3. **A recap closes the month:** landing at $48,200 on a $48,500 budget, $8,700 of waste fixed, the $2,100 cache fix still with the dev tools team, and nobody cut off.

At any point, the chips under the message box suggest the next step first, then useful questions ("Why are we over budget?", "What happens if we do nothing?"). Click any day on the chart to ask what happened that day. The **Users** and **Agents** tabs show who and what is affected, and the **··· menu** switches scenario, turns on **Advanced view** or **Offline replay**. More in [NOTES.md](NOTES.md).

## How it works

**The engine computes every number; Claude never does arithmetic.** `src/engine/` is a deterministic TypeScript model: the forecast, what is driving spend, who goes over their limit, the month's slowing plan (`pacing.ts`), the drafts, and six months of forecast results (`health.ts`).

**Claude chooses what to look at and what to draft.** Each agent gets the engine as validated tools (`get_forecast`, `list_drivers`, `simulate_policy`, the `draft_*` tools and more), so every draft's numbers are the engine's.

**A number check guards the wording.** Every figure Claude writes must match a tool result or a figure the admin gave. A miss gets one corrected retry, then falls back to replay.

**Models by job:** Haiku for short questions, Sonnet for agent runs. State lives in the browser; the server hosts the agent endpoint and the passcode gate. No database.

```
src/engine/      forecast model, scenarios, pacing, evidence, drafts (pure, tested)
src/agents/      tools, prompts, number check, model routing, backends (claude-code | api | replay)
src/replay/      recorded agent runs
src/state/       browser store, agent client, next step and chip rules
src/components/  chat, forecast, chart, tabs, drafts, wizard
src/knowledge/   FAQ and "Ask about this demo" content
```

The data is a constructed month: three teams, about 70 people plus 14 new engineers, 30 days, today is day 18.

## Answer quality evals

`evals/answers/` measures one flow: Claude answering the admin's questions in the chat. 44 cases run through the app's real entry point, with the same prompts, tools, model routing and number check. They cover the chip questions, what-ifs and the ways chat assistants commonly fail: invented figures, half answers, false premises, giving in to pushback and claiming actions not taken. Rule checks are free; live runs add a Claude Sonnet judge for whether each answer answers the question, in plain words, faithful to the tool results. Runs so far went from 43% of answers passing every check to 75 to 84% after the fixes the eval found. Details and commands: [`evals/answers/README.md`](evals/answers/README.md).

## What I'd build next

1. **Real data.** Usage and billing from the Enterprise analytics APIs, and Claude Code's contribution metrics (merged PRs) for evidence.
2. **Results on real history.** On design partners' past months: the day-15 forecast against a straight line, and how much overspend is fixable waste.
3. **The rest of the nudge ladder.** Each person's spend note inside Claude Code, temporarily withdrawing premium models, and fast rollback when a cheaper model costs more.
4. **Say what you want, get one policy.** "Protect the payments refactor, keep Marketing flat, ask me before anything over $5,000" becomes one change to approve.
5. **Toward the six-month goal.** Teams with proof of results move budget automatically; agents pick model and effort by expected return.
6. **Production basics.** SSO, shared server-side state, roles (admin, Finance, owner) and real ticketing for hand-offs.
7. **Evals on every change,** several runs per case, before shipping.

Not possible yet, as the write-up says: proving business value beyond Claude Code, and knowing an agent run's cost in advance (the prototype shows ranges instead). Until then, the admin's budget approvals serve as the interim value signal.

## What I'd do differently with more time

- **Talk to platform owners before building.** The scenarios, waste patterns and thresholds are constructed; I'd test them in interviews and build the demo month from a design partner's real usage.
- **Show less by default.** Where the month lands and whether to fix or fund first; the range, daily bars, per-person detail and workstreams only on request.
- **Make approvals richer.** Approve part of a change, adjust an amount before approving, or add conditions like an end date or a spend ceiling.
- **Solve for the aggregate first.** Predicting the spread of spend across everyone is more feasible than predicting each person's spend or value.
- **Treat agents as their own kind of spender.** Runs, cost per run and failure rate per agent, with budgets per agent and runaway runs caught within hours.

The full list is in [NOTES.md](NOTES.md).

## Research behind it

The main source is Capgemini Research Institute, *The cost of intelligence: Governing AI economics in the agentic enterprise*, November 2026 ([report](https://www.capgemini.com/wp-content/uploads/2026/11/AI_Economics.pdf)), along with FinOps Foundation, McKinsey, Anthropic's Claude Enterprise documentation and ad-platform budget pacing. The full list is in [NOTES.md](NOTES.md); the "Ask about this demo" chat answers from `src/knowledge/DEMO_GUIDE.md`.
