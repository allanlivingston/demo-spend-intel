# About this demo

What this app does, who it is for, and why it works the way it does. The "Ask about this demo" chat answers from this file only.

## What problem does this solve, and for whom?
It is for the admin who rolled out Claude and gets asked by Finance why the bill went up. Claude spend now comes from agents as well as people: Claude Code subagents, connectors and scheduled runs. So it can jump without anyone noticing. The usual tool is a monthly limit per person. A limit like that cuts off the busiest engineers first, while an agent stuck in a loop keeps spending under everyone's limit. The admin needs to know where the month will land, what is causing the gap, and what to do about it.

## What does the app do?
Four things. It forecasts where each team's spend will land against its budget. It splits any gap into waste to fix and new work to fund. It spreads any slowdown evenly across the month, mildest step first, so hard stops are a last resort. And Claude drafts each change for the admin to approve. Nothing changes until the admin approves it.

## Why slow spend instead of cutting people off?
A hard monthly limit stops someone completely, usually late in the month and usually the people doing the most work. This app spreads the slowdown over the whole month instead, mildest step first: some runs move to a cheaper model, some wait, and some are held for a few hours. Spend with the least evidence of results is slowed first; work producing results is protected longest, and the admin is told early so it can be funded. If demand keeps outrunning the budget, some work will still be disrupted, but less, later and more evenly than with a hard limit. A hard stop is the last resort, not the first. Slowing only buys time: the real answer is to fix the waste and fund the work that is producing results.

## What are the steps?
Start with the headline and the button under it. First fix the waste: Claude finds spend that produced nothing, like a connector retrying a failing call, and drafts a policy change. Then fund the new work: send the budget owner a short brief asking for more. (In the advanced view, which splits budget by workstream, you can also approve planned work like a SOC 2 sprint and move unused budget first.) Fixes that need someone else, like a code change in another team's repo, are sent to that owner.

## How does Claude fit in?
An engine computes every number: forecasts, savings and who is slowed. Claude agents look into each problem and draft the change. Every figure Claude writes is checked against the engine before it is shown. The admin approves or declines every change. To save waiting, the likely next step, which is only a draft, starts while you read; if you do something else first, it is stopped and thrown away.

## How do we know it works?
In the advanced view, the Health tab shows the last six months: how often month-end spend landed inside the forecast range, how close it came to budget, how much budget moved between workstreams, and merged PRs and passing tests per $1,000.

## How do we know Claude's answers are right?
Two ways. First, every figure Claude writes must match a number the engine returned; if one doesn't, Claude gets one corrected retry, and then the app shows a recorded answer instead. Second, we built an eval of 44 questions the admin might ask, including the ways chat assistants commonly go wrong: invented figures, half answers, false premises, giving in to pushback and claiming actions not taken. Rule checks and a second Claude model grade every answer for facts, plain words and staying true to the numbers. The first run passed 43% of answers. Fixing what it found brought that to 83% over three runs of every question. Then we moved the answering rules out of one long prompt and into the tools themselves, so each tool returns the figures to quote and how to say them. That reached 89%, with faster answers, and it is what the app uses now.

## Why a chat instead of a dashboard?
A dashboard makes you work out what to do. Here Claude does the looking and drafting, so the conversation is the main screen. It reads top to bottom, newest at the bottom. Charts, drafts and approvals appear inside the conversation, and when numbers change a fresh copy is added at the bottom.

## What do the confidence levels mean?
High, Medium and Low. A fix is usually High because the spend produced nothing. Funding confidence rises with evidence: usage only is Low, merged PRs or a team report is Medium, and code still in place after 30 days is High.

## How is privacy handled?
The app reads billing, usage and cache data, never prompt text. Admins see each person's spend and limit, as they already can in the Claude Enterprise console. Results (merged PRs, passing tests) are counted for the team and the piece of work, not for each person, to address people's concerns about being measured one by one.

## What's real and what's simulated?
The engine, forecasts, savings, checks and the Claude agents are real. The spend data is a made-up month for three teams. Sending to owners and budget owner approval are simulated and recorded in Activity. Nothing leaves the app. Suggested rules are worded by Claude (Haiku, as structured output) when the app is live, and by a fixed template in Offline replay. Either way the app decides what a rule covers and applies it.

## What are the scenarios?
Waste and new work (the default): fix the waste, then fund the new engineers. Normal month: every team on budget. Agents wasting spend: $10,800 of waste from agents that a per-person limit would miss. New engineers ramping: 14 new engineers whose work is producing results.

## What is the advanced view?
Turn it on in the ··· menu. It adds Workstreams (budget split by piece of work), Health (the last six months) and Activity, and lets Claude move unused budget between workstreams.

## What research backs this up?
Three things hold up in outside research from 2026. AI costs are overrunning and hard to forecast: in a Capgemini survey of 500 executives, nearly six in ten faced much higher AI costs than expected, and only 56% were fully confident forecasting them. Companies mostly respond with tighter caps: 53% tightened budgets or controls, while only one in five rethought tools, models or model routing. Return on AI spend is hard to prove, so a better-than-random sense of which spend pays off is a real step forward. And pacing a budget across a period is how ad platforms like Google, Microsoft and OpenAI already keep spend on target.

## How do companies handle AI cost overruns today?
Mostly with tighter limits. Capgemini's report The cost of intelligence (survey of 500 senior executives, September 2026) found 53% of companies that overspent tightened budgets or controls or cut scope, and only one in five changed tools, models or model routing. Six in ten lack a complete view of their AI costs. The FinOps Foundation's 2026 survey found 98% of FinOps teams now manage AI spend, and their top AI challenge is seeing the costs, followed by working out the return. That is the gap this app fills: a forecast, plus fixing the cause instead of just tightening limits.

## Is AI ROI really that hard to measure?
Yes. Infosys found about two-thirds of organizations struggle to measure the return on AI (January 2026). McKinsey's State of AI 2026 found only 37% see AI adding to profit, even though 80% report better personal productivity. Capgemini found even companies that track AI spend can link only 45% of it to proven value. So this app does not wait for exact ROI: it uses known waste patterns and early signals like merged pull requests and passing tests, and gets better as results come in.

## Why borrow pacing from advertising?
Ad platforms faced the same problem: spend that arrives unevenly against a fixed budget. Google Ads spreads a campaign budget evenly over its run and caps a month at about 30 days of the daily budget, letting single days run above or below. Microsoft Advertising adjusts pacing through the day to keep delivery even, and OpenAI's ads manager slows delivery when a campaign is spending ahead of pace. Research on ad pacing compares slowing bids with skipping some auctions, much like this app's cheaper model, waiting and holding steps. Once advertisers could see returns, budgets grew, which is the same path this app aims for.

## What does Anthropic recommend for Claude spend?
Anthropic's Claude Enterprise consumption guide says to start caps conservatively, use group-level limits as a starting point, override for individuals, review them weekly during rollout, and raise a limit when the usage report shows high-value work, because "members at their limit are often your top adopters." Admins can get alerts at 75% and 90% of an organization limit. A member who reaches their limit can't use Claude, Cowork or Claude Code until the next billing period unless an admin raises it. The guide also notes Claude Code and Cowork use tokens much faster than chat. This app keeps that advice but does the reviewing and tuning for the admin.

## Are runaway agents a real cost problem?
Reports say yes, though several figures are secondhand. EY's US AI Pulse survey (July 2026) found 82% of leaders investing in AI are concerned about token costs. A Gartner survey reported only 44% of organizations have financial guardrails for AI, and one industry survey found one in five companies running agents can't stop a runaway agent's spending in real time. Retry loops are a named failure class in published agent incident reports. That is why this app cuts off runaway retries automatically and finds agent waste that per-person limits miss.

## Why does the prompt cache matter so much?
On Anthropic's pricing, reading a prompt from the cache costs a tenth of the normal input price. So when something breaks the cache, like a hook that puts the date at the top of every session, the same work suddenly costs far more. Nothing in a per-person limit shows this, but cache usage numbers do, without reading any prompt.

## What would come next?
Real billing and usage data, results imported from Jira and code history, budget owner approval inside the app, and alerts that open this conversation already focused on the problem.

## How does it learn what I prefer?
When you decline a suggestion, Claude asks why. If the reason will still hold next month ("The team needs it", "It's planned work"), it suggests a rule, such as "For Platform Engineering, don't suggest moving work to a cheaper Claude model." When you apply a fix you could have made alone, it offers a rule for next month, set to Ask me first unless you choose Apply without asking. Claude words the rule; the app sets what it covers and checks the wording (right team, short, plain), falling back to its own wording if a check fails. Nothing becomes a rule until you save it. Each rule has one of three levels: Apply without asking, Ask me first, or Don't suggest. These match the always allow, always ask and deny permission levels in Claude Code and Managed Agents. Rules are stored as data and applied by the app, not left to the model to remember. They are listed at the top of Activity, where you can change or remove them, and they carry over when you try another situation. Reset demo clears them.
