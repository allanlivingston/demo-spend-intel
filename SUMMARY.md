# Claude Spend Intelligence: Pacing, Not Caps — summary

## The message
- Claude spend now comes from agents as well as people, so it jumps without warning.
- The only lever admins have is a monthly limit per person, and it fails both ways:
  - it cuts off the busiest, most productive engineers first, usually late in the month;
  - it misses agent waste that stays under everyone's limit (a looping connector, a broken prompt cache, subagents on Opus).
- Per-person limits are not a budget: total spend is whatever demand falls under each limit (Σ min(demand, limit) ≤ people × limit), not a number anyone chose.
- The answer is pacing, not caps: forecast where each team lands, fix the waste, fund the work that is producing results, and spread any slowdown evenly, mildest step first, with hard stops as a last resort.
- Claude does the investigating and drafting; the admin approves every change.

## The problem (and for whom)
- Customer: the AI platform owner who rolled out Claude Enterprise and defends the bill to Finance every month.
- Measured on two conflicting goals: grow AI adoption, and never surprise Finance.
- Stakeholders: CFO and FP&A (want a forecast they trust), builders (want to keep working).
- Initial focus: usage-based accounts with 500+ seats, heavy Claude Code use, spend limits already on.
- Anthropic's own consumption guide says to start limits low and notes "members at their limit are often your top adopters": the recommended setup blocks the best users by design.
- What's missing today:
  - value and limits live apart: nothing tells you whether a limit is blocking a payments refactor or a looping script;
  - analytics counts blocked people, not blocked work or what it was worth;
  - insight isn't connected to action;
  - limits are hard stops, with no slowing before the wall.

## What the product does
- Forecasts where each team's spend will land this month, with a likely-to-high range.
- Splits any gap into two answers:
  - **Fix it:** spend that produced nothing; fixed by routing and retry changes, never by limiting people.
  - **Fund it:** new work producing results (merged PRs, passing tests); funded by approving planned work or asking the budget owner for more.
- Spreads any slowdown evenly across the month, mildest step first:
  - some runs move to a cheaper model;
  - some wait;
  - some are held for a few hours;
  - a hard stop only as a last resort;
  - spend with the least evidence of results is slowed first, work producing results last, with early warning so it can be funded;
  - some disruption is unavoidable when demand outruns the budget; the aim is the least of it, spread evenly.
- Claude agents (connector, cache, routing, funding) diagnose each problem and draft the change.
- Every number comes from a deterministic engine and is checked before Claude shows it; Finance won't trust a chatbot for budget numbers.
- Nothing changes until the admin approves; every action is logged.

## Why this is the right wedge
- Plugs into the monthly review admins already run.
- Works on day one for every account, including zero-retention and customer-managed-key accounts, because it needs only usage telemetry.
- Extends what Anthropic already shipped (pooled budgets, spend alerts, model defaults, smart reports) instead of adding another tool.
- Shows the hidden cost of limits for the first time: the dollar value of useful work they block.
- Good for Anthropic: hard limits destroy more expansion revenue than fixing waste ever will, and a forecast the CFO trusts unlocks bigger annual commitments.

## What the prototype shows
- Default scenario, Platform Engineering: lands at $56,900 on a $40,000 budget.
- Step 1, fix the waste: $10,800 ($8,700 applied, $2,100 sent to the dev tools team) from a looping Jira connector, Opus subagents and a broken prompt cache; spend drops to $48,200, then $46,100 once the dev tools team ships the cache fix.
- Step 2, fund the new work: 14 new engineers on the payments refactor with 31 merged PRs are protected (the rest of the team absorbs the slowdown); send the budget owner a brief for the rest.
- Claude ends with a summary of what changed: landing within the new budget, nobody cut off this month.
- With a plain monthly limit, 9 new engineers would be cut off by day 22; with pacing, nobody is cut off this month.
- Every step is one button; a suggested next step is always shown.
- Runs live on Claude, or replays recorded runs offline.

## How we'd validate (16 weeks)
- Week 0: interviews with platform owners to confirm the pain.
- Weeks 1–3, backtest on real usage from 5–10 design partners:
  - H1: the forecast on day 15 is at least 30% more accurate than straight-line;
  - H2: at least 30% of overspend is fixable waste;
  - H3: at least 50% of limit blocks hit work that was producing results that week.
- Weeks 4–8, concierge pilot: a weekly fix-or-fund brief to 5 platform owners; track what they accept and whether they raise or lower limits.
- Weeks 9–16, in-product beta: matched teams on pacing vs per-person limits; measure blocked work, forecast accuracy, output per dollar.
- Kill criteria: if overspend is neither fixable waste nor blocked valuable work, fold the forecast into existing analytics and stop.

## Path to product-market fit
- The one signal: platform owners stop reaching for hard limits first.
- Supporting measures:
  - 60%+ of pilot admins act at least weekly;
  - the forecast on day 15 is within 10% of actual spend for 80% of teams;
  - half of pilot teams move off per-person limits;
  - budget briefs actually get sent to Finance;
  - under 30 minutes a month on spend governance;
  - 40%+ would be very disappointed to lose it.
- Roll out to Claude Code-heavy engineering orgs first, where PR and test signals already exist; expand as signals mature elsewhere.

## Six months out
- Teams with strong evidence move budget between workstreams automatically; admins handle exceptions only.
- Work-type labels for zero-retention accounts, without storing any content.
- An annual commit planner: spend vs results by workstream, to size renewals.
- A contractual guarantee on the team budget ceiling, so per-person limits can be retired.

## What isn't possible yet, and what we'd do
- Limits are hard stops: build pace targets and short windows with fallback to a cheaper model into the limits service.
- No workstream budget: model workstreams as sub-groups now; add a project-tag budget in billing.
- Routing isn't tied to budget state: recommend model defaults now; link them to pacing later.
- Value signals exist mainly for Claude Code: one value event schema across Claude Code, Cowork and Chat.
- Business outcomes live in customer systems: opt-in imports from Jira and incident tools.
- Open research: predicting an agent run's cost before it runs; proving Claude caused the result.

## Risks
- Cheaper models that fail and retry cost more: judge routing on cost per completed task; Opus stays one click away.
- Gaming (inflated PR counts, rubber-stamped approvals): credit only for code still in place after 30 days; approval rates visible to the budget owner.
- Surveillance worries: value is judged by workstream, never by person; builder nudges stay private.
- Too many knobs: no setting ships without Claude to set it, explain it and audit it.

## The long game
- Advertising won budgets when measurement got better, not when ads did; AI spend will follow the same path.
- Every approval, fix and funding decision becomes labeled value data, which only Anthropic sees across every surface.
- Better measurement lets pricing move toward value over time.
