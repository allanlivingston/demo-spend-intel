# Notes

Detail moved out of the README to keep it short: the write-up in brief, the full mapping from the write-up to the prototype, demo details, the full list of what I'd do differently with more time, the research sources, and the longer versions of the README's other sections. Useful for the follow-up session.

## The write-up in brief

- **Problem:** spend is hard to predict and its return is hard to see, and caps make it worse. When AI costs overrun, 53% of enterprises restrict spend and only 20% rethink the tools or processes behind it (Capgemini, November 2026). Per-person caps don't add up to a budget, and agents add spend that no person vouches for.
- **Customer:** the AI platform owner who rolled out Claude Enterprise and answers to Finance, the economic buyer. Start with usage-based accounts of 500+ seats that use Claude Code heavily and already set limits.
- **Why this wedge:** it fits the admin's monthly review and needs only usage and billing data, so it works on day one. Only Anthropic can act inside the product, not just report on it: it already ships pooled budgets, spend alerts and model defaults. And when Finance trusts the forecast and sees returns, commitments grow.
- **Validation (16 weeks):**
  - Week 0: interview 5 to 8 platform owners; most confirm limits block valuable work.
  - Weeks 1 to 3: on past data from 5 to 10 design partners, the day-15 forecast has 30%+ less error than a straight line, and 30%+ of overspend is fixable waste.
  - Weeks 4 to 8 pilot: admins accept 50% of recommendations and 60% act weekly.
  - Weeks 9 to 16 beta: fixes deliver 80%+ of predicted savings, hard cap use falls 30%, 80% of agent spend runs under approved policies, and 70% of admins still act weekly.
  - Stop if fewer than 50% of admins act weekly; fold the forecast into existing reports instead.
- **Product-market fit** means platform owners stop reaching for hard limits first: 70% of accounts auto-apply accepted policies, Finance uses the forecast (within 10% for 80% of teams by day 15), hard cap use stays down 30%+, and admins spend under 30 minutes a month managing spend.
- **Six months out:** we optimize outcomes per dollar. Teams with proof of results move budget automatically and admins handle exceptions; agents pick model and effort by expected return.
- **Not possible yet, and what to do about it:**
  - Evidence of results: Claude Code's contribution metrics tie spend to merged PRs, with and without Claude, but proving business value and measuring work outside Claude Code aren't feasible yet. Use the admin's budget approvals as an interim value signal.
  - Accurate cost prediction: knowing an agent run's cost in advance. V1 shows ranges.
- **Risks and guardrails:** the biggest risk is trust in a vendor pacing its own revenue, so every change shows its numbers and needs admin approval, and forecasts show ranges until accuracy is proven. Smaller risks have direct fixes: fast rollback when a cheaper model retries and costs more; spend shown per person but results judged by team; usage-only signals by default, with repo data opt-in, for zero data retention and compliance.

**Scope of the prototype.** Claude Enterprise bundles Claude Code, Cowork and chat under one consumption contract. The prototype focuses on Claude Code and the agents around it (subagents, connectors, scheduled runs), because that is where spend grows fastest and where nobody is in the loop to vouch for it. Chat and Cowork spend would go through the same forecast and pacing; their waste patterns and evidence of results would differ.

**Scope of the prototype.** Claude Enterprise bundles Claude Code, Cowork and chat under one consumption contract. The prototype focuses on Claude Code and the agents around it (subagents, connectors, scheduled runs), because that is where spend grows fastest and where nobody is in the loop to vouch for it. Chat and Cowork spend would go through the same forecast and pacing; their waste patterns and evidence of results would differ.

## From the write-up to the prototype (full table)

| Write-up | In the prototype |
|---|---|
| The admin sets a budget; the system forecasts and paces spend to land on it | Spend forecast (chart, likely and high case) and the month's slowing plan, spread evenly from day 1 |
| Nudges escalate with how far spend is off pace, starting with switching default models | Busy-day overruns move to a lighter default model first (people can switch back); only what that doesn't cover waits or is held for a few hours. A hard stop is a last resort and doesn't happen in the demo month |
| Showing users spend feedback | The private note each person sees (hover a status in the Users tab) |
| Temporarily withdrawing premium models, or requiring a budget request | Not in the prototype; the budget owner brief is the request at team level |
| Once approved, policies cut off runaway agent retries | Proposed changes: auto-retry off after 3 failures for the Jira connector |
| Known waste patterns first | The three waste causes in the example: retry loop, subagents on Opus, broken prompt cache |
| Positive signals: new hires, merged PRs, tests that stay passing | The new engineers' evidence (31 merged PRs, 212 newly passing tests), Medium confidence until the 30-day check |
| Every change shows its numbers and needs admin approval | Drafts come only from the engine; nothing applies without approval |
| Spend shown per person, results judged by team | Users tab shows spend per person; results count for the team and the piece of work |
| Usage-only signals by default | The cache problem is found from usage numbers, not prompt text |

## Demo details

**Tabs (default view):** This month (chart, the slowing summary and, on request, daily bars), Users (everyone's spend, limit and whether they are slowed; the new engineers show "Protected: fund it"; hover a status to see the private note that person sees about their own spend), Agents (subagents, connectors and scheduled runs).

**··· menu:** switch scenario (Waste and new work, Normal month, Agents wasting spend, New engineers ramping), turn on **Advanced view**, turn on **Offline replay**, and see the version.

**Advanced view** adds Workstreams (budget split by piece of work, with confidence), Health (forecast and pacing results for the last six months), Activity, the comparison lines on the chart, a planned SOC 2 documentation sprint on one workstream (approved as planned spend), and a step that moves unused budget between workstreams before asking the budget owner.

**Ask about this demo** (sidebar) answers what the app does and why, including the outside research behind it (see below). **Take the tour** replays the short tour.

**First visit:** a short tour opens (Take the tour in the sidebar replays it). Small pulsing orange dots mark features worth finding (clicking a chart day, Show daily bars, the Users and Agents tabs, Try another situation, opening an earlier forecast copy) until each is first used. **Try another situation** and **Activity** are in the sidebar. Steps about things that may not be on screen yet (rules, slowed spend, asking) show a still example, so the tour reads the same whatever state the page is in. A new question moves to the top of the screen, like claude.ai. A new reply scrolls into view as far down as it can without its first line leaving the top. Dotted-underlined terms (Lands at, Fixable waste, Likely range, slowed) show a one-line definition on hover or tap. To see the first visit again, use `?first` (see URL options).

**Rules:** after a decline, Claude asks why; a lasting reason becomes a suggested rule, and applying a fix you could have made alone offers to do it without asking next month. Live, Claude (Haiku) words each suggested rule as structured output through `/api/rule`; the app sets the rule's scope and level and keeps its own template wording offline or if a check fails. Saved rules (Apply without asking, Ask me first, Don't suggest) are listed at the top of Activity, are applied by the engine (`src/engine/rules.ts`), carry over to the next situation, and are cleared by Reset demo.

## What I'd do differently with more time

### Product and interface

- **Make the interface show less by default.** I'd use progressive disclosure: a simpler forecast first (where the month lands and whether to fix or fund), with the range, daily bars, per-person detail, workstreams, budget moves and forecasting health opening only when the admin asks for them.
- **Try a dual-panel interface.** Evaluate a duet-style layout, with the chat in one panel and the forecast and drafts in a working panel beside it, against the single conversation the prototype uses.
- **Make approvals richer to work with.** Today an approval is all or nothing. I'd let the admin approve part of a change, adjust an amount or a model setting before approving, add conditions (an end date, a spend ceiling, a review on a set day), and ask the owner or Finance a question on the draft itself.
- **Handle rejected recommendations better.** Declining today keeps the item in the forecast and stops it being suggested again, with Restore to bring it back. I'd ask for a short reason, show what the decline costs by month end, bring it back only when the evidence or the spend changes enough, and use declines as a signal for future recommendations.
- **Explore scheduled and longer-running admin tasks.** Spend management is a monthly rhythm, not a single chat. I'd look at tasks that run on a schedule (a weekly review Claude prepares, a month-end summary for Finance) and longer-running management tasks that watch spend between reviews and act within policies the admin has approved, then report what they did.
- **Give the chat a memory.** Each question is sent on its own, so follow-ups like "Why?" can't build on the previous answer.

### Signals and model

- **Solve for the aggregate first.** Predicting the expected spread of spend across all users and agents is more feasible than predicting each person's or each action's spend or value. I'd make that the core of the model and treat individual figures as a view on it, not a prediction in their own right.
- **Lean more on spend shape for signals.** Use relative spend distributions (how a person, team or agent compares with its peers) and spend velocity (how fast spend is rising) as earlier, cheaper signals of waste and of work worth funding.
- **Handle agents better.** Treat agents as their own kind of spender: track each one's runs, cost per run and failure rate, set budgets and policies per agent, and catch runaway runs within hours, not days.
- **Develop projects and workstreams further.** Make the piece of work, not the person or the team, the main unit for budgets and evidence: how workstreams are found from what the company already tracks, how budget moves between them, and how a new project starts with a protected ramp.
- **Show how better ROI confidence feeds the forecast.** Outline step by step how evidence moving from Low to Medium to High would shift what gets protected, slowed and funded, so the change is gradual and the forecast never jumps.
- **Address the manual ROI calculator.** Many buyers expect an explicit ROI calculator. I'd spell out why hand-entered value estimates are hard to get and hard to trust, what such a calculator can and can't show, and how it would relate to the evidence the app collects.

### Validation and process

- **Talk to platform owners before building.** The scenarios, waste patterns and thresholds are constructed. I'd test them in the week-0 interviews first, and build the demo month from a design partner's real usage.
- **Sharpen the target metrics.** Define each validation and product-market fit metric precisely: how it is measured, over which accounts and time window, and the baseline it is compared with.
- **Measure forecasting health across the whole system.** Add global metrics on how well forecasting and pacing work overall, across every team and account: how often the month lands inside the forecast range, how early the forecast settles, and how much work pacing held up. The Health tab does this for one demo company.
- **Add more scenarios, and more ambiguous ones.** The four demo scenarios each have a clear answer. Real months are messier: waste and valuable work in the same workstream, evidence that points both ways, an agent that is both useful and expensive, a forecast that is uncertain early in the month. I'd add those, and use them in the evals to check that answers stay honest about what isn't known.

## Research behind it
The "Ask about this demo" chat answers these from `src/knowledge/DEMO_GUIDE.md`. Sources:
- Capgemini Research Institute, *The cost of intelligence: Governing AI economics in the agentic enterprise* (Research Snapshot), November 2026; survey of 500 senior executives, September 2026: [press release](https://www.capgemini.com/news/press-releases/most-organizations-plan-to-adopt-a-multi-model-ai-strategy-as-nearly-six-in-ten-faced-significantly-higher-ai-costs-than-expected/), [report](https://www.capgemini.com/wp-content/uploads/2026/11/AI_Economics.pdf)
- FinOps Foundation, State of FinOps 2026: [Linux Foundation release](https://www.linuxfoundation.org/press/state-of-finops-survey-ai-value-and-skills-top-priorities-as-finops-matures-across-technology-value-98-manage-ai-90-saas-64-licensing-48-data-center-1)
- McKinsey, [The state of AI in 2026](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai); Infosys, [AI ROI gap](https://www.infosys.com/services/data-ai-topaz/insights/ai-roi-gap/ai-roi-gap.pdf)
- Anthropic, [Claude Enterprise consumption guide](https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide), [additional usage and limits](https://support.claude.com/en/articles/12005970-additional-usage-for-claude-for-work-team-and-enterprise-plans), [prompt caching pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Ad pacing: [Google Ads average daily budgets](https://support.google.com/google-ads/answer/6385083), [Google Ads campaign total budgets](https://support.google.com/google-ads/answer/15137812), [Microsoft daily pacing](https://learn.microsoft.com/en-ca/xandr/monetize/daily-pacing), [OpenAI ads budget pacing](https://help.openai.com/en/articles/20001515-budget-pacing), [pacing vs throttling research](https://arxiv.org/abs/2112.15155)
- Agent costs (secondhand summaries): [CFO Dive on AI costs](https://www.cfodive.com/news/cfos-confront-cash-flow-risks-ai-costs-rise/874554/), [Enterprise DNA on runaway agent spend](https://enterprisedna.co/resources/news/enterprise-ai-agent-spending-one-in-five-cant-control-2026)

## Longer versions of the README's sections

### Introduction

A prototype for the AI platform owner: the IT or engineering productivity lead who rolled out Claude Enterprise and answers to Finance for the bill. It goes with the two-page write-up, *Half my AI spend is wasted; I just don't know which half*, which covers the problem, the customer, the validation plan and the path to product-market fit. This README extends it with how the prototype works.

The write-up's argument in short: an ideal system would fund the highest-return work first until the budget runs out. Two things stand in the way: enterprises can't yet see or trust the return on AI spend, and spend caps alone can't manage it. Per-person caps don't add up to a budget, they cut off the busiest engineers first, and a stuck agent keeps spending under everyone's limit. Digital advertising had the same two problems and made them manageable with spend pacing and better and better conversion estimates.

The prototype covers the write-up's V1:

- **Monthly team forecasts:** where each team's spend will land this month, shown as a range (likely to high case) until accuracy is proven.
- **Fix it or fund it:** splits any gap into waste to fix (spend that produced nothing: retry loops, premium models on routine work, a broken prompt cache) and new work to fund (work producing results, like merged PRs and tests that stay passing).
- **Pacing, least intrusive step first:** the admin sets a budget and the expected overrun is spread over the whole month instead of hitting hard caps at month end. Spend with the least evidence of results is slowed first; work producing results is protected and funded.
- **Basic user-level nudges:** each person gets a private note about their own spend, never shared with the team.
- **Claude drafts every change from the engine's numbers;** the admin approves. Nothing changes until then. Controls are set through chat, so new recommendations can be added without making the interface more complex.

**Try it:** [demo-spend-intel.vercel.app](https://demo-spend-intel.vercel.app) (passcode in the write-up). A small marker next to "Admin" shows **Live** (agents run on Claude), **Replayed** (Live, but the last answer fell back to a recorded run; the reason is in its hover text) or **Offline** (recorded runs only). Every number is computed live either way.

### Built with Claude Code

The app was designed and built in Claude Code: the engine, the interface, the tests, the browser checks and the answers eval. Claude Code also runs inside the app: in development, the agents run through the Claude Agent SDK on the local Claude Code login (no API key), `npm run record` records the replayed runs the same way, and the live eval runs through it too.

### Run it

Requires Node 20+.

```bash
npm install
npm run dev -- -p 3123     # http://localhost:3123
```

**Passcode (optional).** Set `APP_PASSCODE` in `.env.local` to require a passcode before the app opens. Leave it blank for no gate. Restart the server after changing it.

**URL options.**
- `?first` (for example `localhost:3123/?first`) shows the first visit again: it clears the tour flag and the orange dots, starts Waste and new work fresh with no past chats, then removes itself from the address bar. Offline replay is left as it is.
- `?passcode=<code>` fills in the passcode on the unlock page, for a link you share. The person still presses Open. Anyone with the link can get in, so share it only with people who should.

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
npm run eval             # answers eval, offline and free (see "Answer quality evals" below)
npm run build && npm start
```

### Demo walkthrough (about 5 minutes)

The app is one Claude conversation that only moves forward. It opens with a headline, a button for the next step, and a live **Spend forecast**: the chart, a one-line summary of how much pacing slows from today (**Show daily bars** opens the month day by day) and a row of **Recommendations** (Fix or Fund, the amount, High / Medium / Low confidence).

Default scenario, **Waste and new work**, Platform Engineering: heading for $56,900 on a $40,000 budget. This is the write-up's example: $10,800 of waste (a Jira connector retrying a failing call, Claude Code subagents on Opus doing Sonnet-level tasks, a shared Claude Code setup that broke prompt caching) and 14 new engineers who joined mid-month and are shipping. Per-person limits would cut off 9 of them by day 18 while the connector keeps spending.

1. **Fix all the waste** (the button under the headline). The routing agent drafts **Proposed changes**: stop the Jira connector's retry loop and route subagents to Sonnet (you apply these), and the prompt cache fix (sent to the dev tools team). Apply them: spend drops to $48,200.
2. **Draft the budget owner brief.** A request for the rest, backed by the new engineers' evidence (31 merged PRs, 212 newly passing tests). Mark it approved (demo).
3. With nothing left open, a recap closes the month: landing at $48,200 (it was heading for $56,900), budget raised to $48,500 (the $8,200 gap, rounded up to an $8,500 request), $8,700 of waste fixed and the $2,100 cache fix still with the dev tools team. Nobody was cut off this month, and the 14 new engineers were not slowed. Copy summary gives it as plain text for the team or the budget owner. The other 70 engineers mostly get a lighter default model on their busiest days; a small share of their runs (about 3%) wait or are held for a few hours.

At any point, the chips under the message box suggest the next step first, then useful questions ("Why are we over budget?", "What happens if we do nothing?", "How is spend slowed?"). Every answer ends with the next step. Click any day on the chart to ask what happened that day.

### How it works

**The engine computes every number; Claude never does arithmetic.** `src/engine/` is a deterministic, seeded TypeScript model:

- the forecast (likely landing and a high case);
- what is driving spend (each waste or growth driver);
- who goes over their limit, and the month's slowing plan (`pacing.ts`: spread evenly over the month, work producing results protected);
- drafts: proposed changes, planned spend approval, budget owner brief, owner hand-off, budget moves;
- six months of forecast and pacing results (`health.ts`).

**Claude chooses what to look at and what to draft.** Each agent gets the engine as validated tools (`get_forecast`, `list_drivers`, `get_evidence`, `simulate_policy`, `lookup_faq`, the `draft_*` tools and more). Drafts only come from the `draft_*` tools, so their numbers are always the engine's.

**A number check guards the wording.** Every dollar amount, percentage and large number Claude writes must match a tool result, or a figure the admin typed or the Follow up row sent with the question. A miss gets one corrected retry, then falls back to replay.

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

### Answer quality evals

`evals/answers/` measures one flow: Claude answering the admin's questions in the chat. 43 cases run through the app's real entry point, with the same prompts, tools, model routing and number check. They cover the chip questions, Follow up rows, what-ifs, product terms, and the ways chat assistants commonly fail people: invented figures, answering half the question, going along with a false premise, giving in to pushback, claiming an action it didn't take, refusing a fair question, typos and vague questions. Rule checks run free on every case; on live runs a Claude Sonnet judge also checks that each answer answers the question, uses plain words and stays faithful to the tool results. Runs so far went from 43% of answers passing every check to 75 to 84% after the fixes the eval found. Details and commands: [`evals/answers/README.md`](evals/answers/README.md).

### What I'd build next

1. **Real data.** Usage and billing from the Enterprise analytics APIs; Claude Code's contribution metrics (merged PRs, with and without Claude) and cache and retry usage for evidence.
2. **Results on real history.** The write-up's first validation step: on design partners' past months, the day-15 forecast against a straight line, and how much overspend is fixable waste. The Health tab already runs these measures on the demo's six months.
3. **The rest of the nudge ladder.** Showing each person's spend note inside Claude Code, temporarily withdrawing premium models, and fast rollback when a cheaper model retries and costs more.
4. **Say what you want, get one policy.** "Protect the payments refactor, keep Marketing flat, ask me before anything over $5,000" becomes one change to approve.
5. **Toward the write-up's six-month goal.** Teams with proof of results move budget automatically and admins handle exceptions; agents pick model and effort by expected return. Stronger evidence first: code still in place after 30 days, outcomes from Jira and incident tools.
6. **Production basics.** SSO, shared server-side state and audit storage, roles (admin, Finance, owner), real ticketing for hand-offs.
7. **Evals on every change.** Run the answers eval on each prompt or model change, several runs per case, before shipping.

Not possible yet, as the write-up says: proving business value beyond Claude Code, and knowing an agent run's cost in advance (the prototype shows ranges instead). Until then, the admin's budget approvals serve as the interim value signal.
