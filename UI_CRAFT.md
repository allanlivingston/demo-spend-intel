# UI craft guide

How to build and change this app's interface. Distilled from review feedback on the demo. Where a rule came from a
specific correction, the example is in brackets.

## 1. Look and behave like Claude.ai

- **Chat first, not a dashboard.** The conversation is the main surface. Views (forecast, recommendations, drafts) appear inside it as artifacts. This is a demo for Anthropic, not an enterprise suite.
- **Copy Claude.ai's conventions, don't invent new ones.** These include:
  - type sizes, spacing and colors;
  - the model selector inside the message box, with suggestion chips in one row under it;
  - the left nav layout;
  - the collapsible sidebar: open by default, collapse on the icon, peek on hover, pin on the logo. On a phone, no rail: a top bar with a menu button that slides the full sidebar over the page.
- **Check against the real thing.** When unsure, open Claude.ai and compare side by side. [Fonts were smaller and padding wider than Claude's.]
- **Older copies of a view fold to one line,** like Claude artifacts. Clicking expands them. The newest copy is the live one.

## 2. Keep work where the eye is

- **Act on a thing where it is.**
  - Approving a draft happens on the draft, then folds to one line that says what was done.
  - Chatting about a recommendation happens under it.
  - Nothing opens a separate review page.
- **One decision, one button.** Never make the user press two buttons where the second scrolls away after the first. [The fix and its Jira ticket became one Apply.]
- **Put closing and next-step controls where attention already is,** usually at the bottom of the newest message.
- **Scrolling**
  - A question the user types moves to the top, and the answer streams in below it.
  - A new reply scrolls down as far as it can without its first line leaving the top.
  - Never scroll the start of new text out of view.
  - Move calmly but promptly: a hard speed limit of 1,800px a second (about 30px a frame), full speed in about 0.2 seconds, speeding up and slowing down gently. A slow frame pauses the scroll rather than letting it leap to catch up. Stop as soon as the user scrolls. When content above folds, place the new reply mid-screen before the first paint and glide it up from there, so the page never jumps and then scrolls back. (`src/components/glide.ts`)
  - Content never moves down on its own. When something folds, the page keeps a floor at the bottom of the screen so the browser can't pull the scroll back. A glide that runs out of time stops where it is; it never jumps to the target. The browser's scroll anchoring is off on the chat: a card wholly above the screen resizes at once with the scroll moved to match, and anything partly on screen glides. Messages render in one flat list and never change parent: moving one rebuilds it and the browser jumps the scroll to re-anchor. [Apply slid the content above down; Fund it leapt out of view.]
  - After the tour closes, return to the top so the first call to action is visible.
- **One question at a time.** When Claude asks something (save this rule?), it is the last thing on screen: hold what would follow, such as the updated forecast, until it is answered, and put the key result in the question's own message ("now lands at $48,200"). If the user moves on instead, post the held content first; never block. [The forecast after Apply waits for the rule answer.]
- **A confirmation belongs with what it confirms.** Never post it at the bottom when the messages between the action and the bottom haven't been read: the scroll follows it and skips them. [A saved rule's "Saved." used to land under the updated forecast and scroll it off the top.]

- **Motion explains a change, never decorates.** (`src/components/motion.ts`)
  - Only where something the user did changed something: the landing rolls from where it was heading, the forecast line glides from the old curve (which stays as a dashed ghost), an approved card settles with its check drawn, and the month's recap lines arrive one after another.
  - Switching team: the headline block's height glides (360ms) and the new headline fades in, so the forecast moves smoothly instead of jumping. The chart's scale, lines, range and budget line glide to the new team's together. Don't reserve empty space to avoid movement: it looks unfinished. [A fixed-height headline left too much white space.]
  - A new draft grows open, and an approved one folds to its one line, over 360ms with even easing (a fast start drops frames while the new forecast renders). [Apply, Fund it and the budget owner approval jerked the page.]
  - The change a fix makes is drawn, not left to compare: the space between the old forecast and the new one fills green as the line glides down, then the end shows "was $56,900 · saved $8,700" and "$48,200 · $8,200 over"; the stretch above budget is red; fixed causes say "· fixed" or "· sent to owner". On a phone the end labels become one line above the chart.
  - Short and once: 600ms or less, a 250ms pause before a figure moves so the eye finds it, number and line in step.
  - Never on a page load or reload, and none at all with reduced motion.
  - No wipes, slides, bounces or pulsing buttons: they slow the demo and pull attention from the next step.

## 3. Show less by default

- **The chart can be hidden; the figures can't.** Show/Hide chart is remembered for new copies. Until the reader chooses, the opening chart hides once the conversation starts; later copies show theirs. The chart has no legend. Marker dots always show; a dot's label shows when that dot is hovered or tapped (a tap on a dot never asks about the day), and for a few seconds on the causes a change just fixed. The end labels always show. Don't repeat what the chart shows. ["Day 18 of 30" and the walkthrough line "Claude drafts the change…" were removed.] Card headers have no decorative icons.
- **Progressive disclosure.** Lead with one sentence or one summary line and open the detail on request. [The daily bars sit behind a one-line summary.]
- **The default view shows the core idea only.** Workstreams, Health and budget moves live in the advanced view.
- **Never mention something the current view doesn't have.** [A workstream or "SOC 2 sprint" string in the default view.]
- **Delete panels, columns and markers that don't change a decision.** [A flat line column in Health, chart dots that marked nothing, two labels saying the same thing.]
- **Remove controls nobody needs.** [The "jump to" dropdown.] Make utility controls subtle. [Reset demo.]

## 4. Write like a real admin app

- **Plain words.** Say the amount and what to do. No jargon, no internal labels. Confidence is only High, Medium or Low. [Evidence tiers like "T4" were removed everywhere.]
- **Never sell.** No marketing tone, no reassurance lines, nothing that sounds written by an AI. If a sentence could appear in a pitch deck, cut it. [These were cut:]
  - "Nobody is capped. Frontier escalation stays one click away."
  - "None of these measures needs to know what any single piece of work is worth."
- **Short beats complete.** If text explains how something works, it is usually bloat: delete it or move it behind a "?" or a defined term. [A paragraph explaining bar heights under the chart.]
- **No disclaimers** about synthetic data or demo status in the main UI.
- **Buttons use short, fixed labels** ("Fix it", "Apply the changes"), never variable text.
- **Don't promise what can't hold.** [Nothing can guarantee "no work is disrupted".] Soften charged words. ["avoid surveillance" became "address user concerns".]
- **Use one term per idea,** and the same term in the app, the docs and the write-up. ["Slowed" means lighter model defaults first.]
- **No AI badges or waiting theatre.** No sparkle icons marking Claude or AI features, no pulsing or pinging dots, no animated "Thinking…". Claude's messages carry no icon, as in Claude.ai; progress shows as steps. [Sparkles on every message and pulsing new-feature dots were removed.]
- **Don't add notes about how an answer was produced** unless they help the user act. [The "Worded by Claude" label was removed.]

## 5. Numbers and charts tell the truth

- **Every figure comes from the engine** and agrees everywhere it appears: headline, cards, charts, chat, tour, docs.
- **Show the whole period.**
  - The scenario starts mid-month, so past days need real history: pacing, throttling and blocking from day 1.
  - The no-limits projection also starts at day 1.
  - Slowing must be spread across the month, not bunched at the start or end. Bunching means the model is wrong.
- **One combined picture of one system.** Throttling and blocking are one range of actions, so show them as one stacked bar per day, not separate charts or side-by-side bars.
- **A chart has to make sense without a paragraph.** Labels must not overlap, tooltips must not be clipped (watch z-order), and axis labels need room.
- **Plain names on screen, technical names for Claude.** Cards and chart markers use a driver's `plain` name ("Jira link stuck retrying"); Claude, the docs and the eval keep `label`. [A first-time reader didn't know "MCP connector", "subagents" or "cache hit rate".]
- **Examples must match reality.** A tour example said spend came "back under" budget when the real figure was still over. Compute example numbers rather than typing them.

## 6. Guide the user every step

- **The first call to action is obvious on arrival.** The headline says what needs doing and the button under it does it.
- **The next step is always clear.** The first suggestion chip is the next step, and every chip fits the current state.
- **Declining happens on the card.** Decline swaps the card's body for the reasons; a lasting reason offers "Don't suggest this for <team> again" (ticked) and Done. Nothing is posted to the chat, the cards keep their places, and Undo on the card restores it and drops that rule. A rule answer in the chat (after Apply) that is the newest message shows the next step as one button. [Declining a fix posted four messages for what changes no numbers, then ended on "Rule saved".]
- **Close the loop.** When nothing is left open, say what the work came to (a recap with a copy to share), say what is still true ("over budget until the owner ships the fix"), and point forward. Never say "done" while something the user should know about is still pending.
- **Every recommendation can be declined,** every change is logged in Activity, and applied changes can be undone.
- **A failed run offers Retry.** Live vs offline is shown subtly.
- **Teach in place:** dotted-underline terms with one-line definitions, and an orange dot on a feature until it's first used.

## 7. Onboarding (the welcome tour)

- **A dismissable step-by-step tour** that opens on the first visit and can be replayed from the sidebar. It focuses on the core value, not every feature.
- **Each step highlights the real element.** Add a still example picture only when the subject may not be on screen yet (rules, slowed spend, asking). Never animate.
- **The tour's buttons look different from the app's buttons,** so nobody mistakes Next for a real action.
- **The whole card is always on screen.** It sits below, above or beside the element it describes (narrowing to fit beside it if needed) and never covers it. When nothing fits, a step with an example drops the highlight and centers the card; any other step puts the card at the top and the element's top just under it. It never pushes off the edge at any window size, short windows included.
- **No persistent overlays that can drift out of step** with what the user did. [The story strip and pop-up hints were removed as janky.]
- **`?first` replays the first visit** for testing.

## 8. Working agreement

- **Check every UI change in the browser before reporting it done:**
  - every button and chip, at each step of the main flows;
  - phone (390px) and tablet (768px) widths too, in a same-page iframe (don't resize the user's window): no sideways scroll, Send on screen;
  - with Offline replay, in a new tab.
- **Work locally until "push it".** Don't bloat the version count or the README.
- **When feedback is about one string or one screen, fix the same pattern everywhere.**
- **Don't argue a layout the user has decided.** Explain trade-offs once, then build what was asked.

## 9. Rating the app

When asked to rate the app, score the same five things every time, 1 to 10 each, and give the average. Say which version was rated (live or local, and the commit) and compare with the last rating in UPDATE.md. Log the scores there.

| | What it measures | A 10 means |
|---|---|---|
| **Idea** | A clear, arguable point the whole app serves | "Pacing, not caps" is obvious from the headline and every step supports it |
| **Numbers** | Every figure right and consistent | Engine-computed, checked in Claude's answers, the same in cards, charts, chat, tour and docs |
| **First use** | A newcomer gets it without help | Someone who hasn't seen it can explain what it does after 2 minutes, no tour, no voice-over |
| **Polish** | Looks and feels like Claude | Plain words, nothing jumps or snaps, every chip fits the state, no dead ends |
| **Robustness** | Holds up everywhere | Phone, tablet and desktop, reduced motion, Offline replay and live, a failed run recovers |

Don't move a score without naming what changed. A half point between sessions with no change named is noise.
