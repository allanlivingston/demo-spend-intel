# Spend Intelligence FAQ

Answers to questions an admin asks inside the app. Each section is one question. The chat's `lookup_faq` tool and offline mode read this file.

## What is Spend Intelligence?
A way to keep a company's Claude spend on budget with as little disruption as possible. It shows where each team's spend will end the month, what is pushing it up, and gives one of two answers: fix it (spend that produced nothing) or fund it (new work that is producing results). Claude drafts the change; nothing happens until you approve it.

## Why pacing instead of caps?
A monthly limit per person doesn't control spend, it only decides who gets stopped, and it picks the wrong people. A broken connector keeps spending under everyone's limit, while the engineers getting the most done hit their limit first. This app looks at what the spend is producing before deciding what to do.

## How does pacing slow spend instead of blocking?
With a plain monthly limit, people run at full speed and then get cut off, usually near the end of the month. Here, a team's expected overrun is spread evenly over every working day from day 1. A small share of runs move to a cheaper model (the work still gets done), some wait, and some are held for a few hours. Spend with the least evidence of results is slowed first, and work producing results is protected longest, so you have time to fund it. Some work can still be disrupted if demand keeps outrunning the budget; a hard stop is the last resort, not the first. The line under the chart says how much is slowed from today; Show daily bars opens each day's spend with the slowed share on top.

## How do we know this pacing is any good?
We replay the last six months three ways: plain monthly limits, an even monthly allowance, and this app's approach. Then we check simple things: did spend end where we said it would, how much work was held up and when, how far each month ended from budget, and how much got done per $1,000. None of this needs us to know what any single task was worth.

## Why not measure the value of each task?
Results show up late (code is merged days later, and checking that it lasted takes a month), several people and tools share the credit, and each task has little data. Team-level numbers build up much faster, so the app works from those, and leans more on each piece of work's own results as they come in.

## What are the stability rules?
Budget for a piece of work never changes by more than 20% in a month unless you say so. Budget only comes from work that is using less than half of its share. New work keeps its budget for its first month so it has time to show results, and work funded last month isn't cut without a written reason. A small amount is kept back for new work that has no results yet.

## What does "forecast" mean?
Where the team's spend will end the month if nothing changes: spend so far plus the remaining days at today's rate, following the team's usual weekday pattern. The shaded band on the chart shows how high it could reasonably go.

## What is the high case?
A cautious end-of-month figure: higher than expected, but realistic. The band is wider when more spend comes from agents, because agent spend jumps around more than people's spend does.

## What is fixable waste?
Spend that produced nothing and can be stopped without losing any work: a connector retrying a call that keeps failing, Opus doing tasks Sonnet does just as well, or a shared Claude Code setup that stopped the prompt cache working. The amount shown is what fixing it saves between now and the end of the month.

## What is work at risk?
The work that would be stopped if today's monthly limits per person were enforced. It only counts people whose work is producing results, so it is the cost of cutting off the wrong people.

## What does waiting on owner mean?
Some fixes are outside your permissions, like a shared Claude Code setup another team owns. When you apply the changes, those are sent to the owner, and the savings only count once they ship the fix.

## What do High, Medium and Low confidence mean?
How sure the recommendation is. For a fix: how sure we are the spend is wasted (usually High, because nothing was produced). For funding: how strong the proof is that the spend pays off. High: the results are delivered, or the code is still in use after 30 days. Medium: work is being shipped (merged code, passing tests), or the team has reported it, but it isn't proven to last yet. Low: only usage so far.

## Why does the new engineers recommendation have medium confidence?
They have 31 merged pull requests and 212 tests that now pass, so the work is shipping. The check that the code is still in use after 30 days hasn't happened yet, so it isn't High.

## How are workstreams identified?
From things the company already tracks, never from what people type: team groups from the company directory (for example, the payments team), the code project a Claude Code session runs in, and project tags when a team chooses to share them. Budget moves between pieces of work, never between named people.

## What is proposed changes?
The settings Claude suggests changing (which model runs which tasks, how often failing calls retry), shown before and after, with the savings and the new end-of-month figure. Changes you can make are under "You can apply now"; changes that belong to another team are under "Needs the dev tools team" and are sent to them when you apply.

## What is a rebalance?
Only in the advanced view, which splits a team's budget by workstream. It means moving unused budget from work that is spending less than planned to work that is producing results and about to run out. The sharing setting (none, up to 20%, or all) sets how much can move.

## What is planned spend approval?
Approving a specific overspend as planned work, like the SOC 2 documentation sprint, with a reason and where the money comes from. It is logged in Activity, and the budget owner can see how often you approve, so approvals aren't automatic.

## What is a budget owner brief?
A short note asking the budget owner (usually Finance) for more budget when fixing waste and approving planned work aren't enough. It shows the results so far, how much is needed, and where spend ends with it.

## What happens next?
Once nothing is open, nothing else needs you this month. A fix you sent to its owner still counts: the forecast drops when they ship it, and until then the team can stay over budget. If something new comes up, such as another source of waste, it shows up here as a recommendation. Your saved rules carry over to next month.

## What happens if we do nothing?
The waste keeps running to the end of the month, the team goes over budget, and when monthly limits kick in, the engineers getting the most done are cut off first.

## Does the app read our prompts?
No. It only uses billing and usage numbers. The prompt cache problem, for example, was found from cache usage numbers, not from what any prompt says, so it works even for companies that don't let Anthropic keep any data.

## What are the Users and Agents tabs?
Users lists everyone on the team, with the people who need attention first: spend so far, where they end the month, their monthly limit and whether they are slowed. The new engineers show "Protected: fund it". Agents lists spend that runs on its own (Claude Code helpers, connectors to other tools, scheduled runs) with where each ends the month and whether it is running, fixed or waiting on its owner. Ask Claude about any row.

## What do people see about their own spend?
A short private note, only to them, never shared with the team. For example: "About 8% of your runs now use Sonnet or wait a little, to keep the team on budget", or, for the new engineers, "You're past your share, but your work is shipping, so you won't be slowed." Hover over someone's status in the Users tab to see their note.

## Does the app judge individual people?
No. Spend is shown per person, as in the Claude Enterprise console, but results like merged PRs and passing tests are counted for the team and the piece of work, not for each person. That addresses people's concerns about being measured one by one, and budget moves between pieces of work, never between named people.

## Can I decline a recommendation?
Yes. Press Decline on the recommendation card or under a draft, or type "decline it". The card leaves the row; it stays in the forecast but isn't suggested again. Undo, or the "declined" link above the cards, brings it back. Declines are logged in Activity.

## What is Activity?
A list of everything approved, applied, sent or undone, with who did it and when. You can copy it as a spreadsheet.

## What is offline replay?
A demo setting. Claude's earlier answers are replayed against today's numbers instead of calling Claude live, and questions are answered from this FAQ. Every number is still calculated fresh.

## Which Claude models does it use?
Haiku for quick answers, Sonnet when Claude looks into a problem and drafts a fix, and Opus only when you click Ask Opus on an answer. The app picks models the same way it suggests your teams do.
