# UI craft guide

How to build and change this app's interface. Distilled from review feedback on the demo. Where a rule came from a
specific correction, the example is in brackets.

## 1. Look and behave like Claude.ai

- **Chat first, not a dashboard.** The conversation is the main surface. Views (forecast, recommendations, drafts) appear inside it as artifacts. This is a demo for Anthropic, not an enterprise suite.
- **Copy Claude.ai's conventions, don't invent new ones.** These include:
  - type sizes, spacing and colors;
  - the model selector inside the message box, with suggestion chips in one row under it;
  - the left nav layout;
  - the collapsible sidebar: open by default, collapse on the icon, peek on hover, pin on the logo.
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
  - Move calmly: a hard speed limit of 1,000px a second (about 17px a frame), speeding up and slowing down gently. A slow frame pauses the scroll rather than letting it leap to catch up. Stop as soon as the user scrolls. When content above folds, place the new reply mid-screen before the first paint and glide it up from there, so the page never jumps and then scrolls back. (`src/components/glide.ts`)
  - After the tour closes, return to the top so the first call to action is visible.

## 3. Show less by default

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
- **Don't add notes about how an answer was produced** unless they help the user act. [The "Worded by Claude" label was removed.]

## 5. Numbers and charts tell the truth

- **Every figure comes from the engine** and agrees everywhere it appears: headline, cards, charts, chat, tour, docs.
- **Show the whole period.**
  - The scenario starts mid-month, so past days need real history: pacing, throttling and blocking from day 1.
  - The no-limits projection also starts at day 1.
  - Slowing must be spread across the month, not bunched at the start or end. Bunching means the model is wrong.
- **One combined picture of one system.** Throttling and blocking are one range of actions, so show them as one stacked bar per day, not separate charts or side-by-side bars.
- **A chart has to make sense without a paragraph.** Labels must not overlap, tooltips must not be clipped (watch z-order), and axis labels need room.
- **Examples must match reality.** A tour example said spend came "back under" budget when the real figure was still over. Compute example numbers rather than typing them.

## 6. Guide the user every step

- **The first call to action is obvious on arrival.** The headline says what needs doing and the button under it does it.
- **The next step is always clear.** The first suggestion chip is the next step, and every chip fits the current state.
- **Every recommendation can be declined,** every change is logged in Activity, and applied changes can be undone.
- **A failed run offers Retry.** Live vs offline is shown subtly.
- **Teach in place:** dotted-underline terms with one-line definitions, and an orange dot on a feature until it's first used.

## 7. Onboarding (the welcome tour)

- **A dismissable step-by-step tour** that opens on the first visit and can be replayed from the sidebar. It focuses on the core value, not every feature.
- **Each step highlights the real element.** Add a still example picture only when the subject may not be on screen yet (rules, slowed spend, asking). Never animate.
- **The tour's buttons look different from the app's buttons,** so nobody mistakes Next for a real action.
- **The whole card is always on screen.** It sits below, above or beside the element it describes (narrowing to fit beside it if needed), never covers it unless the element is taller than the screen, and never pushes off the edge at any window size.
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
