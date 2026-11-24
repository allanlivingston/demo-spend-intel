# Claude Spend Intelligence: Pacing, Not Caps

A prototype for the admin who owns a company's Claude Enterprise budget. Claude spend now comes from agents as well as people, so it jumps without warning, and the only lever today is a monthly limit per person. That limit cuts off the busiest engineers first while a stuck agent keeps spending under everyone's limit.

This app does four things instead:

- **Forecasts** where each team's spend will land this month, with a likely-to-high range.
- **Fix it or fund it:** splits any gap into waste to fix (spend that produced nothing) and new work to fund (work producing results, like merged PRs).
- **Spreads the slowdown, mildest step first:** a team's expected overrun is spread evenly over the month (some runs move to a cheaper model, some wait, some are held for a few hours; a hard stop only as a last resort). Spend with the least evidence of results is slowed first and work producing results last: it gets funded.
- **Claude drafts every change;** the admin approves. Nothing changes until then.

**Try it:** [demo-spend-intel.vercel.app](https://demo-spend-intel.vercel.app) (passcode in the write-up). A small Live / Offline marker next to "Admin" shows whether agents are running on Claude or replaying recorded runs; every number is computed live either way.

The two-page write-up covers the problem, customer, validation plan and path to product-market fit.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev -- -p 3123     # http://localhost:3123
```

**Passcode (optional).** Set `APP_PASSCODE` in `.env.local` to require a passcode before the app opens. Leave it blank for no gate. Restart the server after changing it.

**How the agents run:**

| Setup | What happens |
|---|---|
| Claude Code installed and signed in on this machine (default in development) | Agents run live through the Claude Agent SDK on your Claude Code login. No API key. Runs count against your Claude plan's usage. |
| `AGENT_BACKEND=api` and `ANTHROPIC_API_KEY` in `.env.local` | Agents run on the Messages API, with a per-session run limit and a daily spend cap (see `.env.example`). |
| No login or key, or **··· menu → Offline replay** | Recorded agent runs replay; every number is recomputed live. Questions are answered offline. Nothing calls Claude. |

A live run that fails, times out or writes a number the engine didn't produce falls back to replay, so the demo never stalls.

Other commands:

```bash
npm test                 # engine, pacing, grounding and click-flow tests
npm run typecheck
npm run lint
npm run walk -- C pe     # print the guided flow: chips, answers and drafts at each step
npm run record           # re-record the agent runs (uses the Claude Code login)
npm run build && npm start
```

## Demo walkthrough (about 5 minutes)

The app is one Claude conversation that only moves forward. It opens with a headline, a button for the next step, and a live **Spend forecast**: the chart, the daily bars and a row of **Recommendations** (Fix or Fund, the amount, High / Medium / Low confidence).

Default scenario, **Waste and new work**, Platform Engineering: heading for $56,900 on a $40,000 budget.

1. **Fix all the waste** (the button under the headline). The routing agent drafts **Proposed changes**: stop the Jira connector's retry loop and route subagents to Sonnet (you apply these), and the prompt cache fix (sent to the dev tools team). Apply them: spend drops to $48,200.
2. **Draft the budget owner brief.** A request for the rest, backed by the new engineers' evidence (31 merged PRs, 212 newly passing tests). Mark it approved (demo).
3. Claude summarises what changed: $10,800 of waste handled, budget raised to $48,500, landing at $48,200. Nobody was cut off this month, and the 14 new engineers were not slowed.

At any point, the chips under the message box suggest the next step first, then useful questions ("Why are we over budget?", "What happens if we do nothing?", "How is spend slowed?"). Every answer ends with the next step. Click any day on the chart to ask what happened that day.

**Tabs (default view):** This month (chart and daily bars), Users (everyone's spend, limit and whether they are slowed; the new engineers show "Protected: fund it"; hover a status to see the private note that person sees about their own spend), Agents (subagents, connectors and scheduled runs).

**··· menu:** switch scenario (Waste and new work, Normal month, Agents wasting spend, New engineers ramping), turn on **Advanced view**, turn on **Offline replay**, and see the version.

**Advanced view** adds Workstreams (budget split by piece of work, with confidence), Health (forecast and pacing results for the last six months), Activity, the comparison lines on the chart, a planned SOC 2 documentation sprint on one workstream (approved as planned spend), and a step that moves unused budget between workstreams before asking the budget owner.

**Ask about this demo** (sidebar) answers what the app does and why, including the outside research behind it (see below). **Run the welcome wizard** replays the short tour.

## How it works

**The engine computes every number; Claude never does arithmetic.** `src/engine/` is a deterministic, seeded TypeScript model:

- the forecast (likely landing and a high case);
- what is driving spend (each waste or growth driver);
- who goes over their limit, and the month's slowing plan (`pacing.ts`: spread evenly over the month, work producing results protected);
- drafts: proposed changes, planned spend approval, budget owner brief, owner hand-off, budget moves;
- six months of forecast and pacing results (`health.ts`).

**Claude chooses what to look at and what to draft.** Each agent gets the engine as validated tools (`get_forecast`, `list_drivers`, `get_evidence`, `simulate_policy`, `lookup_faq`, the `draft_*` tools and more). Drafts only come from the `draft_*` tools, so their numbers are always the engine's.

**A number check guards the wording.** Every dollar amount, percentage and large number Claude writes must match a tool result. A miss gets one corrected retry, then falls back to replay.

**Models by job** (`src/agents/models.ts`): Haiku for short questions, Sonnet for agent runs, Opus on request.

**State** lives in the browser (Zustand, saved to localStorage). The server hosts the agent endpoint (`/api/agent`, server-sent events) and the optional passcode gate. No database.

```
src/engine/      forecast model, scenarios, pacing, evidence, drafts (pure, tested)
src/agents/      tools, prompts, number check, model routing, backends (claude-code | api | replay)
src/replay/      recorded agent runs
src/state/       browser store, agent client, next step and chip rules
src/components/  chat, forecast, chart, tabs, drafts, wizard
src/knowledge/   FAQ and "Ask about this demo" content
```

The data is a constructed month: three teams, about 70 people plus 14 new engineers, 30 days, today is day 18.

## What I'd build next

1. **Real data.** Usage and billing from the Enterprise analytics APIs; Claude Code signals (PRs, tests, cache and retry telemetry) for evidence.
2. **Results on real history.** Run the Health measures on design partners' past months, with a holdout team on per-person limits.
3. **Builder-side nudges in the product.** The app already writes each person's private spend note; next is showing it inside Claude Code, plus a note when a session runs far above its usual cost.
4. **Say what you want, get one policy.** "Protect the payments refactor, keep Marketing flat, ask me before anything over $5,000" becomes one change to approve.
5. **Stronger evidence.** Code still in place after 30 days, and outcomes imported from Jira and incident tools.
6. **Production basics.** SSO, shared server-side state and audit storage, roles (admin, Finance, owner), real ticketing for hand-offs.
7. **Answer quality evals** on every prompt change.

## Research behind it
The "Ask about this demo" chat answers these from `src/knowledge/DEMO_GUIDE.md`. Sources:
- Capgemini Research Institute, *The cost of intelligence: Governing AI economics in the agentic enterprise* (Research Snapshot), November 2026; survey of 500 senior executives, September 2026: [press release](https://www.capgemini.com/news/press-releases/most-organizations-plan-to-adopt-a-multi-model-ai-strategy-as-nearly-six-in-ten-faced-significantly-higher-ai-costs-than-expected/), [report](https://www.capgemini.com/wp-content/uploads/2026/11/AI_Economics.pdf)
- FinOps Foundation, State of FinOps 2026: [Linux Foundation release](https://www.linuxfoundation.org/press/state-of-finops-survey-ai-value-and-skills-top-priorities-as-finops-matures-across-technology-value-98-manage-ai-90-saas-64-licensing-48-data-center-1)
- McKinsey, [The state of AI in 2026](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai); Infosys, [AI ROI gap](https://www.infosys.com/services/data-ai-topaz/insights/ai-roi-gap/ai-roi-gap.pdf)
- Anthropic, [Claude Enterprise consumption guide](https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide), [additional usage and limits](https://support.claude.com/en/articles/12005970-additional-usage-for-claude-for-work-team-and-enterprise-plans), [prompt caching pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Ad pacing: [Google Ads average daily budgets](https://support.google.com/google-ads/answer/6385083), [Google Ads campaign total budgets](https://support.google.com/google-ads/answer/15137812), [Microsoft daily pacing](https://learn.microsoft.com/en-ca/xandr/monetize/daily-pacing), [OpenAI ads budget pacing](https://help.openai.com/en/articles/20001515-budget-pacing), [pacing vs throttling research](https://arxiv.org/abs/2112.15155)
- Agent costs (secondhand summaries): [CFO Dive on AI costs](https://www.cfodive.com/news/cfos-confront-cash-flow-risks-ai-costs-rise/874554/), [Enterprise DNA on runaway agent spend](https://enterprisedna.co/resources/news/enterprise-ai-agent-spending-one-in-five-cant-control-2026)
